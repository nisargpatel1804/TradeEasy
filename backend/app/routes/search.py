import logging
from flask import Blueprint, request, jsonify
from flask_login import login_required
from app.models import AQScrip
from mongoengine.queryset.visitor import Q
from app import limiter

logger = logging.getLogger(__name__)
search_bp = Blueprint("search", __name__)

SEARCH_RESULT_LIMIT = 15
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


def _perform_search(query: str, max_results: int = SEARCH_RESULT_LIMIT) -> list:
    q = _normalize_query(query)
    if len(q) < 2:
        return []

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

    qs = AQScrip.objects(filters & prefix_query & Q(exchangename="NSE")).limit(max_results - len(results))
    _append_from_qs(qs)

    return results


@search_bp.route("/search", methods=["GET"])
@limiter.limit("30 per minute")
@login_required
def search_stocks():
    query = _normalize_query(request.args.get("q", ""))
    if len(query) > MAX_QUERY_LENGTH:
        query = query[:MAX_QUERY_LENGTH]

    if not query or len(query) < 2:
        return jsonify({"success": False, "message": "Query parameter 'q' is required and must be at least 2 characters."}), 400

    try:
        if 'page' in request.args or 'limit' in request.args:
            return jsonify({"success": False, "message": "Pagination parameters are not supported."}), 400
        results = _perform_search(query, max_results=SEARCH_RESULT_LIMIT)

        logger.info(
            "Search query '%s' results=%s",
            query,
            len(results)
        )
        return jsonify(results), 200
    except Exception:
        logger.exception("Error during stock search for query '%s'", query)
        return jsonify({"success": False, "message": "An internal server error occurred. Please try again later."}), 500


