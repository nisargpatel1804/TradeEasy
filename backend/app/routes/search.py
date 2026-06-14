import logging
import base64
import json
from flask import Blueprint, request, jsonify
from flask_login import login_required
from pymongo.errors import OperationFailure
from app.models import AQScrip
from mongoengine.queryset.visitor import Q
from app import limiter

logger = logging.getLogger(__name__)
search_bp = Blueprint("search", __name__)

SEARCH_RESULT_LIMIT = 15
MAX_RESULT_LIMIT = 50
MAX_QUERY_LENGTH = 64
SEARCH_INDEX_HINT = "idx_search_prefix_sort"

def _normalize_query(value: str) -> str:
    return " ".join(str(value or "").split()).strip()

def _format_scrip_result(scrip):
    company_name = scrip.scripfullname.split('-')[0].strip() if scrip.scripfullname and '-' in scrip.scripfullname else (scrip.scripname or scrip.scripshortname)
    short = (scrip.scripshortname or "").strip().upper()
    exch = (scrip.exchangename or "").strip().upper()
    return {
        "symbol": f"{short}.{exch}",
        "name": company_name,
        "exchange": exch,
        "scripcode": scrip.scripcode,
    }


def _encode_page_token(last_shortname: str, last_scripcode: int) -> str:
    payload = {
        "short": str(last_shortname or ""),
        "code": int(last_scripcode),
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _decode_page_token(token: str | None):
    if not token:
        return None
    try:
        data = base64.urlsafe_b64decode(token.encode("ascii"))
        payload = json.loads(data.decode("utf-8"))
        short = str(payload.get("short", "")).strip()
        code = int(payload.get("code"))
        if not short:
            return None
        return short, code
    except Exception:
        return None


def _perform_search(query: str, max_results: int = SEARCH_RESULT_LIMIT, page_token: str | None = None) -> dict:
    q = _normalize_query(query)
    if len(q) < 2:
        return {"results": [], "limit": max_results, "has_next": False, "next_page_token": None}

    if len(q) > MAX_QUERY_LENGTH:
        q = q[:MAX_QUERY_LENGTH]

    filters = (
        Q(optiontype="EQ") &
        Q(issuspended="N") &
        Q(isbanscrip="N")
    )

    results = []
    cursor_rows = []
    seen = set()

    def _append_from_qs(qs):
        nonlocal results, seen, cursor_rows
        for scrip in qs:
            short = (scrip.scripshortname or "").strip()
            if not short:
                continue
            exch = (scrip.exchangename or "").strip()
            key = (short.upper(), exch.upper(), int(scrip.scripcode) if scrip.scripcode is not None else None)
            if key in seen:
                continue
            seen.add(key)
            results.append(_format_scrip_result(scrip))
            cursor_rows.append((short, int(scrip.scripcode)))
            if len(results) >= (max_results + 1):
                break

    prefix_query = (
        Q(scripshortname__istartswith=q) |
        Q(scripname__istartswith=q) |
        Q(scripfullname__istartswith=q)
    )

    qs = (
        AQScrip.objects(filters & prefix_query & Q(exchangename="NSE"))
        .only('scripshortname', 'scripname', 'scripfullname', 'exchangename', 'scripcode')
        .order_by('scripshortname', 'scripcode')
    )

    cursor = _decode_page_token(page_token)
    if page_token and cursor is None:
        raise ValueError("Invalid page_token")

    if cursor is not None:
        short, code = cursor
        qs = qs.filter(
            __raw__={
                '$or': [
                    {'scripshortname': {'$gt': short}},
                    {'scripshortname': short, 'scripcode': {'$gt': code}},
                ]
            }
        )

    hinted_qs = qs
    try:
        hinted_qs = qs.hint(SEARCH_INDEX_HINT)
    except Exception:
        # If hint cannot be applied during query construction, continue without it.
        hinted_qs = qs

    hinted_qs = hinted_qs.limit(max_results + 1)
    try:
        _append_from_qs(hinted_qs)
    except OperationFailure as exc:
        logger.debug("Search index hint failed for query '%s'; retrying without hint. Error: %s", query, exc)
        _append_from_qs(qs.limit(max_results + 1))

    has_next = len(results) > max_results
    if has_next:
        results = results[:max_results]
        cursor_rows = cursor_rows[:max_results]

    next_page_token = None
    if has_next and cursor_rows:
        last_short, last_code = cursor_rows[-1]
        next_page_token = _encode_page_token(
            last_short,
            last_code
        )

    return {
        "results": results,
        "limit": max_results,
        "has_next": has_next,
        "next_page_token": next_page_token,
    }


@search_bp.route("/search", methods=["GET"])
@limiter.limit("30 per minute")
@login_required
def search_stocks():
    query = _normalize_query(request.args.get("q", ""))
    page_token = request.args.get("page_token", "").strip() or None
    raw_limit = request.args.get("limit", str(SEARCH_RESULT_LIMIT))

    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Parameter 'limit' must be an integer."}), 400

    if limit <= 0:
        return jsonify({"success": False, "message": "Parameter 'limit' must be greater than 0."}), 400
    limit = min(limit, MAX_RESULT_LIMIT)

    if len(query) > MAX_QUERY_LENGTH:
        query = query[:MAX_QUERY_LENGTH]

    if not query or len(query) < 2:
        return jsonify({"success": False, "message": "Query parameter 'q' is required and must be at least 2 characters."}), 400

    try:
        payload = _perform_search(query, max_results=limit, page_token=page_token)
        results = payload.get("results", [])

        logger.info(
            "Search query '%s' limit=%s results=%s has_next=%s has_token=%s",
            query,
            limit,
            len(results),
            payload.get("has_next", False),
            bool(payload.get("next_page_token")),
        )
        return jsonify({
            "success": True,
            **payload,
        }), 200
    except ValueError as err:
        return jsonify({"success": False, "message": str(err)}), 400
    except Exception:
        logger.exception("Error during stock search for query '%s'", query)
        return jsonify({"success": False, "message": "An internal server error occurred. Please try again later."}), 500


