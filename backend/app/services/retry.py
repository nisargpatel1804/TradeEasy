"""
Simple retry/backoff utility for services.
"""
import logging
import random
import time
from typing import Any, Callable, Tuple, Type

logger = logging.getLogger(__name__)


def retry(
    fn: Callable[[], Any],
    exceptions: Tuple[Type[BaseException], ...] = (Exception,),
    max_attempts: int = 3,
    initial_delay: float = 0.05,
    backoff: float = 2.0,
    jitter: bool = False,
) -> Any:
    """
    Call `fn` and retry on specified exceptions using exponential backoff.

    Args:
        fn: Callable with no arguments to execute.
        exceptions: Exception class or tuple of exception classes to catch and retry on.
        max_attempts: Total attempts including first call.
        initial_delay: Delay before first retry (in seconds).
        backoff: Multiplier for delay on each retry.
        jitter: Add small random jitter (up to 10%) to delay when True.

    Returns:
        The return value of `fn()`.

    Raises:
        The last caught exception if all attempts fail.
    """
    attempt = 0
    while True:
        attempt += 1
        try:
            return fn()
        except exceptions as e:
            if attempt >= max_attempts:
                logger.exception("All retry attempts (%s/%s) failed: %s", attempt, max_attempts, e)
                raise
            delay = initial_delay * (backoff ** (attempt - 1))
            if jitter:
                delay = delay * (1 + random.random() * 0.1)
            logger.debug("Retry attempt %s/%s after %.3fs due to: %s", attempt, max_attempts, delay, e)
            time.sleep(delay)