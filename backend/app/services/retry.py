"""Simple retry/backoff utility for services.
"""
import time
import random
import logging
from typing import Callable, Iterable, Tuple

logger = logging.getLogger(__name__)


def retry(fn: Callable[[], any], exceptions: Tuple= (Exception,), max_attempts: int = 3, initial_delay: float = 0.05, backoff: float = 2.0, jitter: bool = False):
    """Call `fn` and retry on specified exceptions using exponential backoff.

    Args:
        fn: Callable with no arguments to execute.
        exceptions: Exception class or tuple to catch and retry on.
        max_attempts: Total attempts including first call.
        initial_delay: Delay before first retry (seconds).
        backoff: Multiplier for delay each retry.
        jitter: Add small random jitter to delay when True.

    Raises:
        The last exception if all attempts fail.
    """
    attempt = 0
    while True:
        attempt += 1
        try:
            return fn()
        except exceptions as e:
            if attempt >= max_attempts:
                logger.exception("All retry attempts failed (%s): %s", attempt, e)
                raise
            delay = initial_delay * (backoff ** (attempt - 1))
            if jitter:
                delay = delay * (1 + random.random() * 0.1)
            logger.debug("Retry attempt %s/%s after %.3fs due to: %s", attempt, max_attempts, delay, e)
            time.sleep(delay)