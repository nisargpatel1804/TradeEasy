import json
import pandas as pd
import matplotlib.pyplot as plt
import mplcursors  # For interactive pointer
from datetime import datetime

# Use the correct file path
file_path = r"D:\TEMP-PROJECT\TradeEasy\backend\tests\data\TATAMOTORS.json"

# Load historical stock data from JSON file
with open(file_path, "r") as file:
    data = json.load(file)

# Extract historical prices
historical_prices = data.get("historical_prices", {})

# Check if historical prices exist
if historical_prices:
    # Convert historical prices to DataFrame
    df = pd.DataFrame.from_dict(historical_prices, orient="index")
    df.index = pd.to_datetime(df.index)  # Convert index to datetime
    df = df.sort_index()  # Ensure data is sorted by date

    # Create subplots for price and volume
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 8), gridspec_kw={"height_ratios": [3, 1]})

    # Plot Open Prices on the first subplot
    ax1.plot(df.index, df["Open"], label="Open Price", color="blue")
    ax1.set_ylabel("Stock Price (INR)")
    ax1.set_title("Tata Motors Open Price Trend")
    ax1.legend()
    ax1.grid()

    # Plot Volume on the second subplot
    ax2.bar(df.index, df["Volume"], color="green", alpha=0.6, label="Volume")
    ax2.set_xlabel("Date")
    ax2.set_ylabel("Volume")
    ax2.legend()
    ax2.grid()

    # Add interactive pointer to the price chart
    cursor = mplcursors.cursor(ax1, hover=True)
    cursor.connect(
        "add", lambda sel: sel.annotation.set_text(
            f"Date: {datetime.fromtimestamp(sel.target[0]).strftime('%Y-%m-%d')}\nPrice: {sel.target[1]:.2f}"
        )
    )

    plt.tight_layout()
    plt.show()
else:
    print("No historical price data found in the JSON file.")