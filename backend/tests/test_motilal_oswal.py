import requests

# API Key and Endpoint
API_KEY = "FoZlJIugzmVgSecW"
BASE_URL = "https://openapi.motilaloswaluat.com/rest/report/v1/getltpdata"

def fetch_stock_data(exchange, scripcode):
    """Fetch LTP data for a stock using the Motilal Oswal API."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-API-KEY": API_KEY,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",  # Corrected
        "Referer": "https://www.motilaloswal.com/",
        "Origin": "https://www.motilaloswal.com"
    }

    payload = {
        "exchange": exchange,
        "scripcode": scripcode
    }

    try:
        print(f"\n🔍 Sending request to: {BASE_URL}")
        print(f"📄 Request Headers: {headers}")
        print(f"📦 Request Payload: {payload}\n")

        response = requests.post(BASE_URL, headers=headers, json=payload)

        print(f"📥 Response Status Code: {response.status_code}")
        print(f"📝 Response Headers: {response.headers}")
        print(f"🟢 Raw Response: {response.text}\n")

        response.raise_for_status()
        if "application/json" in response.headers.get("Content-Type", ""):
            print("✅ Response JSON:", response.json())
        else:
            print("⚠️ Non-JSON Response:", response.text)

    except requests.exceptions.HTTPError as e:
        print(f"❌ HTTP Error: {e} - {response.text}")
    except requests.exceptions.RequestException as e:
        print(f"❌ Request Error: {e}")
    except ValueError as e:
        print(f"❌ JSON Decode Error: {e}")

if __name__ == "__main__":
    fetch_stock_data("BSE", 500317)
