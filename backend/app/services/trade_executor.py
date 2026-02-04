import logging
import secrets
import time
from decimal import Decimal
from datetime import datetime
from mongoengine import Q
from app.models import Transaction, Holding, Lot, User, ShortPosition
# Avoid importing route modules at top-level to prevent circular imports (import inside functions if needed)
from app.services.cache import cache as app_cache
from app.services.retry import retry

logger = logging.getLogger(__name__)

# Simple in-memory counters for basic observability (replace with real metrics in production)
_metrics = {
    "holding_update_retries": 0,
    "short_upsert_retries": 0
}

class TradeExecutor:
    """
    Centralized service for executing trades with atomic database operations.
    Handles both immediate Market orders and triggered Pending orders.
    Implements optimistic locking and atomic increments to prevent race conditions.
    """

    MAX_RETRIES = 3  # Max retries for optimistic locking updates

    @classmethod
    def execute_buy(cls, user_id, symbol, quantity, price, product_type, order_type, 
                   transaction_id=None, idempotency_key=None, is_pending_execution=False, reserved_amount=0.0):
        """
        Executes a Buy order.
        
        Args:
            user_id: User ID.
            symbol: Stock symbol.
            quantity: Quantity to buy.
            price: Execution price.
            product_type: 'CNC' or 'MIS'.
            order_type: 'MARKET', 'LIMIT', etc.
            transaction_id: ID of existing pending transaction (if triggered).
            idempotency_key: Key for deduplication.
            is_pending_execution: True if this is a triggered pending order (funds already reserved).
            reserved_amount: The amount originally reserved for this order (to release).
        """
        try:
            # 1. Fetch User
            user = User.objects(id=user_id).first()
            if not user:
                return {"success": False, "message": "User not found"}

            exec_price = Decimal(str(price))
            total_cost = exec_price * Decimal(quantity)
            reserved_amt = Decimal(str(reserved_amount)) if is_pending_execution else Decimal('0')

            # 2. Handle Transaction Record (Atomic Lock)
            transaction = None
            if transaction_id:
                # Atomically transition PENDING -> PROCESSING
                updated = Transaction.objects(
                    id=transaction_id, 
                    status='PENDING'
                ).update_one(set__is_processing=True, set__execution_date=datetime.utcnow())
                
                if updated == 0:
                    logger.warning(f"Order {transaction_id} is already being processed or executed.")
                    return {"success": False, "message": "Order already processed"}
                
                transaction = Transaction.objects(id=transaction_id).first()
            else:
                # For new Market orders, check idempotency
                if idempotency_key:
                    existing = Transaction.objects(idempotency_key=idempotency_key).first()
                    if existing:
                        return {
                            "success": True, 
                            "message": "Order already executed (duplicate)", 
                            "transaction_id": str(existing.id),
                            "duplicate": True
                        }
                
                # Create the transaction record
                transaction = Transaction(
                    user=user,
                    symbol=symbol,
                    action='BUY',
                    quantity=quantity,
                    price=float(price),
                    status='PENDING', # Temporary status while we process funds
                    is_processing=True,
                    order_type=order_type,
                    product_type=product_type,
                    idempotency_key=idempotency_key or secrets.token_urlsafe(32),
                    execution_date=datetime.utcnow()
                )
                transaction.save()

            # 3. ATOMIC FUND DEDUCTION
            fund_update_success = False
            
            if is_pending_execution:
                # For triggered orders: Release reserved amount AND deduct actual cost.
                # Ensure (available balance + reserved amount) covers total_cost.
                needed_balance = total_cost - reserved_amt
                try:
                    if needed_balance <= 0:
                        # Reserved covers cost entirely; allow update without balance check
                        res = User.objects(id=user.id).update_one(
                            inc__balance=-float(total_cost),
                            inc__reserved_balance=-float(reserved_amt)
                        )
                    else:
                        # Require available balance to be >= needed_balance
                        res = User.objects(id=user.id, balance__gte=float(needed_balance)).update_one(
                            inc__balance=-float(total_cost),
                            inc__reserved_balance=-float(reserved_amt)
                        )
                except Exception as e:
                    logger.exception("Error updating user funds for pending execution: %s", e)
                    res = 0

                if res > 0:
                    fund_update_success = True
                    # Sanity cleanup to prevent floating point drift
                    User.objects(id=user.id, reserved_balance__lt=0).update_one(set__reserved_balance=0)
                else:
                    logger.error(f"Fund deduction failed for pending order {transaction.id}")
                    
            else:
                # Market Order: Standard atomic deduction from Balance
                res = User.objects(
                    id=user.id, 
                    balance__gte=float(total_cost)
                ).update_one(
                    inc__balance=-float(total_cost)
                )
                fund_update_success = (res > 0)

            if not fund_update_success:
                transaction.status = 'CANCELLED'
                transaction.is_processing = False
                transaction.metadata = "Insufficient funds during execution"
                transaction.save()
                return {"success": False, "message": "Insufficient funds"}

            # 4. EXECUTE ASSETS (Short Cover or New Holding)
            shares_to_hold = quantity
            shares_covered = 0
            
            # 4a. MIS Short Cover Logic
            if product_type == 'MIS':
                short_pos = ShortPosition.objects(user=user, symbol=symbol, is_active=True).first()
                if short_pos:
                    cover_qty = min(quantity, short_pos.quantity)
                    
                    # Atomic update of short position
                    SP = ShortPosition.objects(
                        id=short_pos.id, 
                        quantity__gte=cover_qty
                    ).update_one(
                        inc__quantity=-cover_qty
                    )
                    
                    if SP > 0:
                        shares_covered = cover_qty
                        shares_to_hold -= cover_qty
                        
                        short_pos.reload()
                        if short_pos.quantity <= 0:
                            short_pos.is_active = False
                            short_pos.save()
                        
                        logger.info(f"Covered {cover_qty} short shares for {symbol}")

            # 4b. Add remaining shares to Holding
            if shares_to_hold > 0:
                cls._add_shares_to_holding(user, symbol, shares_to_hold, float(exec_price), product_type)
                
                # Create Lot for FIFO
                Lot(
                    user=user,
                    symbol=symbol,
                    quantity=shares_to_hold,
                    original_quantity=shares_to_hold,
                    purchase_price=float(exec_price),
                    purchase_date=datetime.utcnow(),
                    purchase_transaction=transaction,
                    product_type=product_type,
                    is_active=True
                ).save()

            # 5. Finalize Transaction
            transaction.status = 'EXECUTED'
            transaction.price = float(exec_price) 
            transaction.is_processing = False
            transaction.save()

            # 6. Trigger Side Effects (Bracket Legs)
            if order_type == 'BRACKET':
                try:
                    cls.create_bracket_legs(user, transaction, symbol, quantity, product_type)
                except Exception as e:
                    logger.error(f"Failed to create bracket legs: {e}")

            # 7. Invalidate Cache
            app_cache.invalidate_pattern(f"route:get_profile:user:{user.id}")
            app_cache.invalidate_pattern(f"route:get_portfolio:user:{user.id}")

            return {
                "success": True,
                "message": "Buy order executed successfully",
                "transaction_id": str(transaction.id),
                "shares_added": shares_to_hold,
                "shares_covered": shares_covered,
                "price": float(exec_price)
            }

        except Exception as e:
            logger.error(f"Critical error in execute_buy: {e}", exc_info=True)
            if 'transaction' in locals() and transaction:
                try:
                    transaction.reload()
                    if transaction.is_processing:
                        transaction.is_processing = False
                        transaction.save()
                except Exception as rollback_exc:
                    logger.exception("Failed while trying to reset transaction state after execute_buy error: %s", rollback_exc)
            return {"success": False, "message": f"System error: {str(e)}"}

    @classmethod
    def execute_sell(cls, user_id, symbol, quantity, price, product_type, order_type,
                    transaction_id=None, idempotency_key=None, is_pending_execution=False, allow_short=False):
        """
        Executes a Sell order.
        Handles checking holdings (or reserved holdings), atomic deduction, and balance crediting.
        """
        try:
            user = User.objects(id=user_id).first()
            if not user:
                return {"success": False, "message": "User not found"}

            exec_price = Decimal(str(price))
            total_proceeds = exec_price * Decimal(quantity)

            # 1. Handle Transaction Record
            transaction = None
            if transaction_id:
                updated = Transaction.objects(
                    id=transaction_id, 
                    status='PENDING'
                ).update_one(set__is_processing=True, set__execution_date=datetime.utcnow())
                
                if updated == 0:
                    return {"success": False, "message": "Order already processed"}
                transaction = Transaction.objects(id=transaction_id).first()
            else:
                if idempotency_key:
                    existing = Transaction.objects(idempotency_key=idempotency_key).first()
                    if existing:
                        return {"success": True, "duplicate": True, "transaction_id": str(existing.id)}
                
                transaction = Transaction(
                    user=user,
                    symbol=symbol,
                    action='SELL',
                    quantity=quantity,
                    price=float(price),
                    status='PENDING',
                    is_processing=True,
                    order_type=order_type,
                    product_type=product_type,
                    idempotency_key=idempotency_key or secrets.token_urlsafe(32),
                    execution_date=datetime.utcnow()
                )
                transaction.save()

            # 2. ATOMIC ASSET DEDUCTION
            shares_sold_from_holding = 0
            short_sold_qty = 0
            deduction_success = False
            
            # --- RACE CONDITION FIX: Optimistic Locking Loop ---
            for _ in range(cls.MAX_RETRIES):
                holding = Holding.objects(user=user, symbol=symbol, product_type=product_type).first()
                if not holding:
                    break

                if is_pending_execution:
                    # Pending Sell: Simple Atomic update is safe here because we are only touching reserved
                    # which was locked previously by this exact order.
                    res = Holding.objects(
                        id=holding.id,
                        reserved_quantity__gte=quantity
                    ).update_one(
                        inc__quantity=-quantity,
                        inc__reserved_quantity=-quantity
                    )
                    if res > 0:
                        shares_sold_from_holding = quantity
                        deduction_success = True
                    break # No need to retry pending execution failures (if it fails, shares aren't there)
                else:
                    # Market Sell: Must ensure we don't sell reserved shares.
                    # We check available quantity, then try to update while ensuring reserved_qty hasn't changed.
                    available = holding.quantity - holding.reserved_quantity
                    if available >= quantity:
                        res = Holding.objects(
                            id=holding.id,
                            quantity__gte=quantity,
                            # OPTIMISTIC LOCK: Fail update if reserved_quantity changed since read
                            reserved_quantity=holding.reserved_quantity 
                        ).update_one(
                            inc__quantity=-quantity
                        )
                        if res > 0:
                            shares_sold_from_holding = quantity
                            deduction_success = True
                            break # Success
                        else:
                            # Update failed (reserved qty changed by another thread?), retry loop
                            continue
                    else:
                        break # Not enough shares
            
            # 3. Handle Short Selling
            if not deduction_success:
                if product_type == 'MIS' and allow_short:
                    # Short sell logic
                    short_sold_qty = quantity
                    cls._upsert_short_position(user, symbol, quantity, float(exec_price))
                    deduction_success = True
                else:
                    # Failed
                    msg = "Insufficient shares to sell" if not is_pending_execution else "Reserved shares synchronization error"
                    transaction.status = 'CANCELLED'
                    transaction.is_processing = False
                    transaction.metadata = msg
                    transaction.save()
                    
                    # Fix: If it was a pending order that failed to deduct, strictly speaking we should
                    # ensure the reservation is released if it exists.
                    if is_pending_execution and holding:
                         logger.warning(f"Reverting reserved quantity for failed pending sell {transaction.id}")
                         Holding.objects(id=holding.id).update_one(inc__reserved_quantity=-quantity)
                         
                    return {"success": False, "message": msg}

            # 4. CREDIT BALANCE
            User.objects(id=user.id).update_one(inc__balance=float(total_proceeds))

            # 5. MATCH LOTS
            if shares_sold_from_holding > 0:
                cls._process_fifo_lots(user, symbol, shares_sold_from_holding, product_type)

            if holding:
                holding.reload()
                if holding.quantity <= 0 and holding.reserved_quantity <= 0:
                    holding.delete()

            # 6. Finalize Transaction
            transaction.status = 'EXECUTED'
            transaction.price = float(exec_price)
            transaction.is_processing = False
            transaction.save()

            # 7. Bracket Legs
            if order_type == 'BRACKET':
                try:
                    cls.create_bracket_legs(user, transaction, symbol, quantity, product_type)
                except Exception as e:
                    logger.error(f"Failed to create bracket legs for sell: {e}")

            # 8. Cache Invalidation
            app_cache.invalidate_pattern(f"route:get_profile:user:{user.id}")
            app_cache.invalidate_pattern(f"route:get_portfolio:user:{user.id}")

            return {
                "success": True,
                "message": "Sell order executed successfully",
                "transaction_id": str(transaction.id),
                "price": float(exec_price)
            }

        except Exception as e:
            logger.error(f"Critical error in execute_sell: {e}", exc_info=True)
            if 'transaction' in locals() and transaction:
                try:
                    transaction.reload()
                    if transaction.is_processing:
                        transaction.is_processing = False
                        transaction.save()
                except Exception as rollback_exc:
                    logger.exception("Failed while trying to reset transaction state after execute_sell error: %s", rollback_exc)
            return {"success": False, "message": f"System error: {str(e)}"}

    @classmethod
    def create_pending_order(cls, user_id, symbol, action, quantity, price, order_type, product_type, **kwargs):
        """
        Creates a pending order and reserves funds/shares ATOMICALLY.
        """
        try:
            user = User.objects(id=user_id).first()
            if not user:
                return {"success": False, "message": "User not found"}

            price_dec = Decimal(str(price))
            qty_dec = Decimal(quantity)
            total_value = price_dec * qty_dec

            # 1. RESERVE RESOURCES
            if action == 'BUY':
                # Atomic check and update
                res = User.objects(
                    id=user.id,
                    balance__gte=float(total_value) + user.reserved_balance 
                ).update_one(inc__reserved_balance=float(total_value))
                
                # Double check
                user.reload()
                if user.balance < user.reserved_balance:
                    User.objects(id=user.id).update_one(inc__reserved_balance=-float(total_value))
                    return {"success": False, "message": "Insufficient available funds"}

            elif action == 'SELL':
                holding = Holding.objects(user=user, symbol=symbol, product_type=product_type).first()
                if not holding:
                     if product_type == 'MIS':
                         # Allow pending short sell without holding? Depends on broker rules.
                         # Here we assume yes for MIS if defined in business logic, but strict for CNC.
                         pass
                     else:
                         return {"success": False, "message": "No holdings to sell"}
                else:
                    available = holding.quantity - holding.reserved_quantity
                    if available < quantity:
                        return {"success": False, "message": "Insufficient available shares"}
                    
                    res = Holding.objects(id=holding.id).update_one(inc__reserved_quantity=quantity)
                    if res == 0:
                         return {"success": False, "message": "Failed to reserve shares"}

            # 2. Create Transaction
            txn = Transaction(
                user=user,
                symbol=symbol,
                action=action,
                quantity=quantity,
                price=float(price),
                status='PENDING',
                order_type=order_type,
                product_type=product_type,
                stop_loss_price=kwargs.get('stop_loss_price'),
                target_price=kwargs.get('target_price'),
                trailing_stop_pct=kwargs.get('trailing_stop_pct'),
                parent_order_id=kwargs.get('parent_order_id'),
                bracket_order_type=kwargs.get('bracket_order_type'),
                idempotency_key=kwargs.get('idempotency_key') or secrets.token_urlsafe(32)
            )
            txn.save()

            return {"success": True, "transaction_id": str(txn.id)}

        except Exception as e:
            logger.error(f"Error creating pending order: {e}", exc_info=True)
            return {"success": False, "message": str(e)}

    @classmethod
    def modify_exit_plan(cls, user_id, symbol, available_qty, stop_price, target_price, product_type):
        """
        Updates or Creates OCO (One Cancels Other) orders for Exit Plan.
        Crucially: Reserves the shares ONCE for TWO pending orders.
        """
        try:
            user = User.objects(id=user_id).first()
            if not user: return {"success": False, "message": "User not found"}
            
            # 1. Reserve Shares (Atomic)
            # We reserve the full available quantity once. 
            # Both Stop and Target will point to this same reservation logically.
            if available_qty > 0:
                holding = Holding.objects(user=user, symbol=symbol, product_type=product_type).first()
                if not holding: return {"success": False, "message": "Holding not found"}
                
                # Verify and Reserve
                curr_avail = holding.quantity - holding.reserved_quantity
                if curr_avail < available_qty:
                    return {"success": False, "message": "Insufficient available shares"}
                
                res = Holding.objects(id=holding.id).update_one(inc__reserved_quantity=available_qty)
                if res == 0: return {"success": False, "message": "Failed to reserve shares"}
            
            # 2. Create/Update Orders
            response = {}
            # Use a shared parent ID to identify them as siblings for cancellation logic
            parent_id = f"EXITPLAN:{user_id}:{int(datetime.utcnow().timestamp())}"
            
            # STOP LOSS LEG
            if stop_price:
                sl_txn = Transaction(
                    user=user, symbol=symbol, action='SELL', quantity=available_qty,
                    price=float(stop_price), status='PENDING', order_type='STOP_LOSS',
                    product_type=product_type, stop_loss_price=float(stop_price),
                    parent_order_id=parent_id, bracket_order_type='STOP_LOSS',
                    idempotency_key=secrets.token_urlsafe(32)
                )
                sl_txn.save()
                response['stop_order_id'] = str(sl_txn.id)

            # TARGET LEG
            if target_price:
                tgt_txn = Transaction(
                    user=user, symbol=symbol, action='SELL', quantity=available_qty,
                    price=float(target_price), status='PENDING', order_type='LIMIT',
                    product_type=product_type, target_price=float(target_price),
                    parent_order_id=parent_id, bracket_order_type='TARGET',
                    idempotency_key=secrets.token_urlsafe(32)
                )
                tgt_txn.save()
                response['target_order_id'] = str(tgt_txn.id)
                
            return {"success": True, "exit_plan": response}

        except Exception as e:
            logger.error(f"Error modifying exit plan: {e}")
            return {"success": False, "message": str(e)}

    @classmethod
    def cancel_order(cls, user_id, order_id):
        """
        Cancels a pending order and atomically releases resources.
        Handles OCO siblings intelligently to avoid double-release.
        """
        try:
            # 1. Lock Transaction
            txn = Transaction.objects(id=order_id, user=user_id, status='PENDING').first()
            if not txn:
                return {"success": False, "message": "Order not found or not pending"}
            
            res = Transaction.objects(id=order_id, status='PENDING').update_one(set__status='CANCELLED')
            if res == 0:
                return {"success": False, "message": "Order execution in progress, cannot cancel"}

            # 2. Release Resources
            if txn.action == 'BUY':
                total_val = Decimal(str(txn.price)) * Decimal(txn.quantity)
                User.objects(id=user_id).update_one(inc__reserved_balance=-float(total_val))
                User.objects(id=user_id, reserved_balance__lt=0).update_one(set__reserved_balance=0)
                
            elif txn.action == 'SELL':
                holding = Holding.objects(user=user_id, symbol=txn.symbol, product_type=txn.product_type).first()
                if holding:
                    # Release shares
                    Holding.objects(id=holding.id).update_one(inc__reserved_quantity=-txn.quantity)
                    Holding.objects(id=holding.id, reserved_quantity__lt=0).update_one(set__reserved_quantity=0)

            # 3. Cancel Sibling Legs (OCO / Exit Plan)
            # If this order is part of an Exit Plan, cancelling one implies cancelling the other.
            # CRITICAL: Since `modify_exit_plan` reserved shares ONCE for the PAIR, 
            # and we just released them above, we must simply mark the sibling as CANCELLED 
            # without triggering `cancel_order` on it (which would try to release shares again).
            
            if txn.parent_order_id and txn.bracket_order_type in ['STOP_LOSS', 'TARGET']:
                siblings = Transaction.objects(
                    parent_order_id=txn.parent_order_id, 
                    status='PENDING', 
                    id__ne=txn.id
                )
                for sib in siblings:
                    # Mark sibling cancelled but DO NOT call cancel_order (avoid double release)
                    Transaction.objects(id=sib.id).update_one(set__status='CANCELLED')
                    logger.info(f"Auto-cancelled sibling order {sib.id} for OCO consistency.")
            
            return {"success": True, "message": "Order cancelled"}

        except Exception as e:
            logger.error(f"Error cancelling order: {e}", exc_info=True)
            return {"success": False, "message": str(e)}

    # --- PRIVATE HELPERS ---

    @classmethod
    def _add_shares_to_holding(cls, user, symbol, quantity, price, product_type):
        """Updates holding quantity atomically with optimistic locking and exponential backoff on contention."""
        for attempt in range(cls.MAX_RETRIES):
            holding = Holding.objects(user=user, symbol=symbol, product_type=product_type).first()
            
            if not holding:
                try:
                    def _create():
                        Holding(
                            user=user,
                            symbol=symbol,
                            quantity=quantity,
                            average_price=price,
                            product_type=product_type
                        ).save()
                    retry(_create, exceptions=(Exception,), max_attempts=cls.MAX_RETRIES, initial_delay=0.05, backoff=2.0, jitter=True)
                    return
                except Exception as e:
                    _metrics["holding_update_retries"] += 1
                    logger.warning("Failed to create Holding after retries for %s: %s", symbol, e, exc_info=True)
                    continue
            
            old_qty = Decimal(holding.quantity)
            old_avg = Decimal(str(holding.average_price))
            new_qty_chunk = Decimal(quantity)
            new_price = Decimal(str(price))
            
            total_val = (old_qty * old_avg) + (new_qty_chunk * new_price)
            new_total_qty = old_qty + new_qty_chunk
            new_avg_price = float(total_val / new_total_qty)
            
            res = Holding.objects(
                id=holding.id,
                quantity=holding.quantity # Optimistic Lock
            ).update_one(
                set__average_price=new_avg_price,
                inc__quantity=quantity
            )
            
            if res > 0:
                return
            else:
                    # Backoff briefly before retrying
                    wait = 0.02 * (2 ** attempt)
                    _metrics["holding_update_retries"] += 1
                    logger.debug("Optimistic lock contention for holding %s (attempt %s/%s), backing off %.3fs", symbol, attempt+1, cls.MAX_RETRIES, wait)
                    time.sleep(wait)
        logger.warning(f"Failed to update average price for {symbol} after retries. Updating quantity only.")
        Holding.objects(user=user, symbol=symbol, product_type=product_type).update_one(inc__quantity=quantity)

    @classmethod
    def _upsert_short_position(cls, user, symbol, quantity, price):
        """Updates or creates short position with average price calculation."""
        for attempt in range(cls.MAX_RETRIES):
            short_pos = ShortPosition.objects(user=user, symbol=symbol, is_active=True).first()
            
            if not short_pos:
                try:
                    def _create_sp():
                        ShortPosition(
                            user=user, symbol=symbol, quantity=quantity, 
                            short_price=price, is_active=True
                        ).save()
                    retry(_create_sp, exceptions=(Exception,), max_attempts=cls.MAX_RETRIES, initial_delay=0.05, backoff=2.0, jitter=True)
                    return
                except Exception as e:
                    _metrics["short_upsert_retries"] += 1
                    logger.warning("Failed to create ShortPosition after retries for %s: %s", symbol, e, exc_info=True)
                    continue
            
            old_qty = Decimal(short_pos.quantity)
            old_price = Decimal(str(short_pos.short_price))
            new_qty = Decimal(quantity)
            new_p = Decimal(str(price))
            
            total = (old_qty * old_price) + (new_qty * new_p)
            avg = float(total / (old_qty + new_qty))
            
            res = ShortPosition.objects(id=short_pos.id, quantity=short_pos.quantity).update_one(
                set__short_price=avg,
                inc__quantity=quantity
            )
            
            if res > 0:
                return
        
        ShortPosition.objects(user=user, symbol=symbol, is_active=True).update_one(inc__quantity=quantity)

    @classmethod
    def _process_fifo_lots(cls, user, symbol, qty_to_sell, product_type):
        """Updates Lots based on FIFO logic."""
        remaining = qty_to_sell
        lots = Lot.objects(
            user=user, symbol=symbol, product_type=product_type, 
            is_active=True, quantity__gt=0
        ).order_by('purchase_date')
        
        for lot in lots:
            if remaining <= 0:
                break
            
            deduct = min(remaining, lot.quantity)
            Lot.objects(id=lot.id).update_one(inc__quantity=-deduct)
            
            if lot.quantity - deduct <= 0:
                Lot.objects(id=lot.id).update_one(set__is_active=False)
                
            remaining -= deduct

    @classmethod
    def create_bracket_legs(cls, user, entry_txn, symbol, quantity, product_type):
        """
        Creates Stop Loss and Target legs for a Bracket Order.
        Handles Manual OCO reservation to prevent double-counting.
        """
        exit_action = 'SELL' if entry_txn.action == 'BUY' else 'BUY'
        
        # Manual OCO Logic for SELL legs (Exit Long Position)
        if exit_action == 'SELL':
            # Reserve Qty ONCE for both potential sell orders
            res = Holding.objects(user=user, symbol=symbol, product_type=product_type).update_one(inc__reserved_quantity=quantity)
            if res == 0:
                logger.error("Failed to reserve shares for Bracket Legs")
                return

            if entry_txn.stop_loss_price:
                Transaction(
                    user=user, symbol=symbol, action='SELL', quantity=quantity,
                    price=float(entry_txn.stop_loss_price), status='PENDING',
                    order_type='STOP_LOSS', product_type=product_type,
                    stop_loss_price=float(entry_txn.stop_loss_price),
                    parent_order_id=str(entry_txn.id), bracket_order_type='STOP_LOSS',
                    idempotency_key=secrets.token_urlsafe(32)
                ).save()
            
            if entry_txn.target_price:
                Transaction(
                    user=user, symbol=symbol, action='SELL', quantity=quantity,
                    price=float(entry_txn.target_price), status='PENDING',
                    order_type='LIMIT', product_type=product_type,
                    target_price=float(entry_txn.target_price),
                    parent_order_id=str(entry_txn.id), bracket_order_type='TARGET',
                    idempotency_key=secrets.token_urlsafe(32)
                ).save()

        # Handle Short Cover Brackets (Buy Legs - Exit Short Position)
        elif exit_action == 'BUY':
            if entry_txn.stop_loss_price:
                Transaction(
                    user=user, symbol=symbol, action='BUY', quantity=quantity,
                    price=float(entry_txn.stop_loss_price), status='PENDING',
                    order_type='STOP_LOSS', product_type=product_type,
                    stop_loss_price=float(entry_txn.stop_loss_price),
                    parent_order_id=str(entry_txn.id), bracket_order_type='STOP_LOSS',
                    idempotency_key=secrets.token_urlsafe(32)
                ).save()

            if entry_txn.target_price:
                Transaction(
                    user=user, symbol=symbol, action='BUY', quantity=quantity,
                    price=float(entry_txn.target_price), status='PENDING',
                    order_type='LIMIT', product_type=product_type,
                    target_price=float(entry_txn.target_price),
                    parent_order_id=str(entry_txn.id), bracket_order_type='TARGET',
                    idempotency_key=secrets.token_urlsafe(32)
                ).save()