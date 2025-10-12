"""
Initialization file for the 'routes' package.

This file makes the 'routes' directory a Python package, allowing the main
application factory to import all the blueprints defined in the route modules.
Each import statement corresponds to a .py file that defines a Flask Blueprint.
"""

# Import each blueprint module to make them available for registration
from . import auth
from . import data_management
from . import markets
from . import orders
from . import portfolio
from . import profile
from . import search
from . import stock
from . import trade
from . import watchlist
