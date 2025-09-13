/**
 * Market hours utility for checking if the market is currently open
 * Indian stock market hours: 9:15 AM to 3:30 PM (Monday to Friday)
 * Includes basic holiday detection and weekend handling
 */

export class MarketHours {
  constructor() {
    // Market timing in IST
    this.MARKET_OPEN_HOUR = 9
    this.MARKET_OPEN_MINUTE = 15
    this.MARKET_CLOSE_HOUR = 15
    this.MARKET_CLOSE_MINUTE = 30
    
    // Market days (Monday = 1, Sunday = 0)
    this.MARKET_DAYS = [1, 2, 3, 4, 5] // Monday to Friday
    
    // Common market holidays (basic list - in practice, this should be more comprehensive)
    this.MARKET_HOLIDAYS = [
      // Format: YYYY-MM-DD
      '2024-01-26', // Republic Day
      '2024-03-08', // Holi
      '2024-03-29', // Good Friday
      '2024-08-15', // Independence Day
      '2024-10-02', // Gandhi Jayanti
      '2024-11-01', // Diwali
      '2024-12-25', // Christmas
      // Add more holidays as needed
    ]
  }

  /**
   * Check if current date is a market holiday
   * @param {Date} date - Date to check (defaults to current date)
   * @returns {boolean} - True if it's a market holiday
   */
  isMarketHoliday(date = new Date()) {
    const istTime = new Date(date.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}))
    const dateString = istTime.toISOString().split('T')[0]
    return this.MARKET_HOLIDAYS.includes(dateString)
  }

  /**
   * Check if current time is within market hours
   * @returns {boolean} - True if market is open
   */
  isMarketOpen() {
    const now = new Date()
    
    // Convert to IST
    const istTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}))
    
    const currentDay = istTime.getDay()
    const currentHour = istTime.getHours()
    const currentMinute = istTime.getMinutes()
    
    // Check if it's a market holiday
    if (this.isMarketHoliday(istTime)) {
      return false
    }
    
    // Check if it's a market day
    if (!this.MARKET_DAYS.includes(currentDay)) {
      return false
    }
    
    // Convert times to minutes for easier comparison
    const currentTimeInMinutes = currentHour * 60 + currentMinute
    const marketOpenInMinutes = this.MARKET_OPEN_HOUR * 60 + this.MARKET_OPEN_MINUTE
    const marketCloseInMinutes = this.MARKET_CLOSE_HOUR * 60 + this.MARKET_CLOSE_MINUTE
    
    // Check if current time is within market hours
    return currentTimeInMinutes >= marketOpenInMinutes && currentTimeInMinutes <= marketCloseInMinutes
  }

  /**
   * Check if current day is a market day (not weekend or holiday)
   * @returns {boolean} - True if today is a market day
   */
  isMarketDay() {
    const now = new Date()
    const istTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}))
    const currentDay = istTime.getDay()
    
    // Check if it's a weekend
    if (!this.MARKET_DAYS.includes(currentDay)) {
      return false
    }
    
    // Check if it's a holiday
    if (this.isMarketHoliday(istTime)) {
      return false
    }
    
    return true
  }

  /**
   * Get time until market opens/closes
   * @returns {Object} - Market status and time information
   */
  getMarketStatus() {
    const now = new Date()
    const istTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}))
    
    const isOpen = this.isMarketOpen()
    const isMarketDay = this.isMarketDay()
    const isHoliday = this.isMarketHoliday(istTime)
    
    return {
      isOpen,
      isMarketDay,
      isHoliday,
      currentTime: istTime.toLocaleTimeString(),
      currentDay: istTime.toLocaleDateString('en-US', { weekday: 'long' }),
      timeZone: 'Asia/Kolkata'
    }
  }

  /**
   * Get next market open time
   * @returns {Date} - Next market open time
   */
  getNextMarketOpen() {
    const now = new Date()
    const istTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}))
    
    let nextOpen = new Date(istTime)
    nextOpen.setHours(this.MARKET_OPEN_HOUR, this.MARKET_OPEN_MINUTE, 0, 0)
    
    // If market is closed today, find next market day
    if (!this.isMarketOpen() || !this.isMarketDay()) {
      do {
        nextOpen.setDate(nextOpen.getDate() + 1)
        nextOpen.setHours(this.MARKET_OPEN_HOUR, this.MARKET_OPEN_MINUTE, 0, 0)
      } while (!this.MARKET_DAYS.includes(nextOpen.getDay()) || this.isMarketHoliday(nextOpen))
    }
    
    return nextOpen
  }
}

// Create singleton instance
const marketHours = new MarketHours()

export default marketHours
