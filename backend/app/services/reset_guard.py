import logging
import os
from datetime import datetime, timedelta, timezone

from app.models import User

logger = logging.getLogger(__name__)

# A reset lock older than this is treated as stale and safely cleared.
RESET_LOCK_TIMEOUT_SECONDS = int(os.getenv("RESET_LOCK_TIMEOUT_SECONDS", "120"))


def _utcnow() -> datetime:
    """Returns timezone-aware UTC current time standard for Python 3.12+."""
    return datetime.now(timezone.utc)


def _is_stale_reset_lock(reset_started_at: datetime | None, now: datetime | None = None) -> bool:
    if not reset_started_at:
        return True
    now = now or _utcnow()

    # Normalize naive datetimes loaded from database to UTC aware for accurate comparison
    if reset_started_at.tzinfo is None and now.tzinfo is not None:
        reset_started_at = reset_started_at.replace(tzinfo=timezone.utc)

    return reset_started_at <= (now - timedelta(seconds=RESET_LOCK_TIMEOUT_SECONDS))


def clear_stale_reset_lock(user_id) -> bool:
    """Clears a stale reset lock for a user, returns True when lock was cleared."""
    now = _utcnow()
    cutoff = now - timedelta(seconds=RESET_LOCK_TIMEOUT_SECONDS)

    updated = User.objects(
        id=user_id,
        reset_in_progress=True,
        reset_started_at__lte=cutoff,
    ).update_one(
        set__reset_in_progress=False,
        unset__reset_started_at=1,
    )

    if updated:
        logger.warning("Cleared stale reset lock for user %s", user_id)
        return True

    # Handle legacy/stuck records missing reset_started_at.
    updated_missing_started_at = User.objects(
        id=user_id,
        reset_in_progress=True,
        reset_started_at=None,
    ).update_one(
        set__reset_in_progress=False,
        unset__reset_started_at=1,
    )

    if updated_missing_started_at:
        logger.warning("Cleared stale reset lock without timestamp for user %s", user_id)
        return True

    return False


def is_user_reset_in_progress(user_id, auto_clear_stale: bool = True) -> bool:
    """Returns whether reset lock is active, optionally auto-clearing stale locks."""
    user_doc = User.objects(id=user_id).only("reset_in_progress", "reset_started_at").first()
    if not user_doc:
        return False

    in_progress = bool(getattr(user_doc, "reset_in_progress", False))
    if not in_progress:
        return False

    if auto_clear_stale and _is_stale_reset_lock(getattr(user_doc, "reset_started_at", None)):
        if clear_stale_reset_lock(user_id):
            return False

    return True


def acquire_reset_lock(user_id) -> tuple[bool, bool]:
    """Attempts to acquire reset lock and self-heals stale lock if needed.

    Returns:
        (acquired, stale_lock_cleared)
    """
    now = _utcnow()
    updated = User.objects(id=user_id, reset_in_progress__ne=True).update_one(
        set__reset_in_progress=True,
        set__reset_started_at=now,
    )
    if updated:
        return True, False

    stale_cleared = clear_stale_reset_lock(user_id)
    if stale_cleared:
        retry = User.objects(id=user_id, reset_in_progress__ne=True).update_one(
            set__reset_in_progress=True,
            set__reset_started_at=now,
        )
        if retry:
            return True, True

    return False, stale_cleared