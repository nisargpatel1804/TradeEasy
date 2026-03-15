import logging
from flask import Blueprint, request, jsonify
from flask_login import login_required
from app.models import AQScrip
from mongoengine.queryset.visitor import Q
from app import limiter

logger = logging.getLogger(__name__)
search_bp = Blueprint("search", __name__)

SEARCH_RESULT_LIMIT = 15
MAX_RESULT_LIMIT = 50
MAX_QUERY_LENGTH = 64

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


def _perform_search(query: str, max_results: int = SEARCH_RESULT_LIMIT, page: int = 1) -> dict:
    q = _normalize_query(query)
    if len(q) < 2:
        return {"results": [], "page": page, "limit": max_results, "has_next": False}

    if len(q) > MAX_QUERY_LENGTH:
        q = q[:MAX_QUERY_LENGTH]

    filters = (
        Q(optiontype="EQ") &
        Q(issuspended="N") &
        Q(isbanscrip="N")
    )

    results = []
    seen = set()

    def _append_from_qs(qs):
        nonlocal results, seen
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
            if len(results) >= max_results:
                break

    prefix_query = (
        Q(scripshortname__istartswith=q) |
        Q(scripname__istartswith=q) |
        Q(scripfullname__istartswith=q)
    )

    offset = max(0, (page - 1) * max_results)
    qs = AQScrip.objects(filters & prefix_query & Q(exchangename="NSE")).skip(offset).limit(max_results + 1)
    _append_from_qs(qs)

    has_next = len(results) > max_results
    if has_next:
        results = results[:max_results]

    return {
        "results": results,
        "page": page,
        "limit": max_results,
        "has_next": has_next,
    }


@search_bp.route("/search", methods=["GET"])
@limiter.limit("30 per minute")
@login_required
def search_stocks():
    query = _normalize_query(request.args.get("q", ""))
    raw_page = request.args.get("page", "1")
    raw_limit = request.args.get("limit", str(SEARCH_RESULT_LIMIT))

    try:
        page = max(1, int(raw_page))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Parameter 'page' must be a positive integer."}), 400

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
        payload = _perform_search(query, max_results=limit, page=page)
        results = payload.get("results", [])

        logger.info(
            "Search query '%s' page=%s limit=%s results=%s has_next=%s",
            query,
            page,
            limit,
            len(results),
            payload.get("has_next", False),
        )
        return jsonify({
            "success": True,
            **payload,
        }), 200
    except Exception:
        logger.exception("Error during stock search for query '%s'", query)
        return jsonify({"success": False, "message": "An internal server error occurred. Please try again later."}), 500


