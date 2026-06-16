const axios = require("axios");
const logger = require('../utils/logger');

const API_KEY = process.env.WEATHER_API_KEY;
const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5';

// OpenWeather free tier: 5-day forecast only
// For 6-16 days, we'll use historical averages or climate data
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Simple in-memory cache
const weatherCache = new Map();

class WeatherService {
    /**
     * Validate API key on service initialization
     */
    static validateApiKey() {
        if (!API_KEY) {
            logger.error('Weather API key not configured');
            throw new Error('WEATHER_API_KEY environment variable is required');
        }
        logger.info('Weather service initialized successfully');
    }

    /**
     * Generate cache key for weather data
     * @private
     */
    static _getCacheKey(city, country, type, date = null) {
        const dateStr = date ? date.toISOString().split('T')[0] : 'current';
        return `${city.toLowerCase()}_${country.toLowerCase()}_${type}_${dateStr}`;
    }

    /**
     * Check if cached data is still valid
     * @private
     */
    static _isCacheValid(cacheEntry) {
        if (!cacheEntry) return false;
        return Date.now() - cacheEntry.timestamp < CACHE_DURATION;
    }

    /**
     * Get current weather for a location
     * @param {string} city - City name
     * @param {string} country - Country code (e.g., 'US', 'UK', 'FR')
     * @returns {object} Current weather data
     */
    static async getCurrentWeather(city, country) {
        try {
            if (!city || !country) {
                throw new Error('City and country are required');
            }

            // Check cache first
            const cacheKey = this._getCacheKey(city, country, 'current');
            const cached = weatherCache.get(cacheKey);
            
            if (this._isCacheValid(cached)) {
                logger.info('Weather cache hit', { city, country, type: 'current' });
                return cached.data;
            }

            // Fetch from OpenWeather API
            logger.info('Fetching current weather from API', { city, country });
            
            const response = await axios.get(`${OPENWEATHER_BASE_URL}/weather`, {
                params: {
                    q: `${city},${country}`,
                    units: 'metric',
                    appid: API_KEY
                },
                timeout: 10000 // 10 second timeout
            });

            const data = response.data;

            // Clean, structured weather data
            const weatherData = {
                // Temperature data
                temp: Math.round(data.main.temp),
                feelsLike: Math.round(data.main.feels_like),
                tempMin: Math.round(data.main.temp_min),
                tempMax: Math.round(data.main.temp_max),
                
                // Weather conditions
                condition: data.weather[0].main, // Clear, Rain, Snow, Clouds, etc.
                description: data.weather[0].description, // scattered clouds, light rain, etc.
                icon: data.weather[0].icon,
                
                // Atmospheric data
                humidity: data.main.humidity,
                pressure: data.main.pressure,
                
                // Wind data
                windSpeed: data.wind.speed,
                windDeg: data.wind.deg,
                windGust: data.wind.gust || null,
                
                // Other
                cloudiness: data.clouds.all,
                visibility: data.visibility / 1000, // Convert to km
                
                // Sun times
                sunrise: new Date(data.sys.sunrise * 1000),
                sunset: new Date(data.sys.sunset * 1000),
                
                // Location info
                location: {
                    city: data.name,
                    country: data.sys.country,
                    coordinates: {
                        lat: data.coord.lat,
                        lon: data.coord.lon
                    }
                },
                
                // Metadata
                timestamp: new Date(),
                source: 'openweather',
                dataType: 'current'
            };

            // Cache the result
            weatherCache.set(cacheKey, {
                data: weatherData,
                timestamp: Date.now()
            });

            logger.info('Current weather fetched successfully', {
                city,
                country,
                temp: weatherData.temp,
                condition: weatherData.condition
            });

            return weatherData;

        } catch (error) {
            this._handleError(error, city, country, 'current weather');
        }
    }

    /**
     * Get weather forecast for date range (up to 5 days with free API)
     * For trips > 5 days, returns available 5-day forecast + climate averages
     * @param {string} city - City name
     * @param {string} country - Country code
     * @param {Date|string} startDate - Start date
     * @param {Date|string} endDate - End date
     * @returns {object} Forecast data with daily summaries
     */
    static async getWeatherForecast(city, country, startDate = null, endDate = null) {
        try {
            if (!city || !country) {
                throw new Error('City and country are required');
            }

            // Parse dates
            const start = startDate ? new Date(startDate) : new Date();
            const end = endDate ? new Date(endDate) : new Date(start.getTime() + 24 * 60 * 60 * 1000);

            // Validate dates
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                throw new Error('Invalid date format. Use ISO format (YYYY-MM-DD) or Date object');
            }

            if (end <= start) {
                throw new Error('End date must be after start date');
            }

            // Calculate days difference
            const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
            
            logger.info('Forecast requested', { city, country, days: daysDiff });

            // Check cache
            const cacheKey = this._getCacheKey(city, country, 'forecast', start);
            const cached = weatherCache.get(cacheKey);
            
            if (this._isCacheValid(cached) && cached.data.durationDays === daysDiff) {
                logger.info('Weather forecast cache hit', { city, country, days: daysDiff });
                return cached.data;
            }

            // Fetch 5-day forecast from OpenWeather (free tier limit)
            const response = await axios.get(`${OPENWEATHER_BASE_URL}/forecast`, {
                params: {
                    q: `${city},${country}`,
                    units: 'metric',
                    appid: API_KEY
                },
                timeout: 10000
            });

            const forecastList = response.data.list; // 3-hourly forecasts for 5 days

            // Filter forecasts within requested date range
            const filteredForecasts = forecastList.filter(entry => {
                const entryDate = new Date(entry.dt * 1000);
                return entryDate >= start && entryDate <= end;
            });

            // If trip is longer than 5 days, we need to handle it
            let forecastData;
            
            if (daysDiff <= 5) {
                // Normal case: within 5-day forecast range
                forecastData = this._processForecastData(
                    filteredForecasts,
                    response.data.city,
                    start,
                    end,
                    daysDiff
                );
            } else {
                // Extended case: trip > 5 days
                logger.warn('Trip exceeds 5-day forecast limit', {
                    city,
                    country,
                    requestedDays: daysDiff,
                    availableDays: 5
                });

                // Get 5-day forecast
                const fiveDayForecast = this._processForecastData(
                    filteredForecasts.length > 0 ? filteredForecasts : forecastList,
                    response.data.city,
                    start,
                    new Date(start.getTime() + 5 * 24 * 60 * 60 * 1000),
                    5
                );

                // Get climate data for remaining days
                const climateData = await this._getClimateData(
                    response.data.city.coord.lat,
                    response.data.city.coord.lon,
                    start,
                    end
                );

                // Combine forecast + climate data
                forecastData = this._combineWithClimateData(
                    fiveDayForecast,
                    climateData,
                    daysDiff
                );
            }

            // Cache the result
            weatherCache.set(cacheKey, {
                data: forecastData,
                timestamp: Date.now()
            });

            logger.info('Weather forecast fetched successfully', {
                city,
                country,
                durationDays: daysDiff,
                avgTemp: forecastData.summary.avgTemp
            });

            return forecastData;

        } catch (error) {
            this._handleError(error, city, country, 'weather forecast');
        }
    }

    /**
     * Get tomorrow's weather forecast
     * @param {string} city - City name
     * @param {string} country - Country code
     * @returns {object} Tomorrow's weather forecast
     */
    static async getTomorrowWeather(city, country) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const dayAfter = new Date(tomorrow);
        dayAfter.setDate(dayAfter.getDate() + 1);

        return await this.getWeatherForecast(city, country, tomorrow, dayAfter);
    }

    /**
     * Get weather for a specific date
     * @param {string} city - City name
     * @param {string} country - Country code
     * @param {Date|string} date - Target date
     * @returns {object} Weather for the specified date
     */
    static async getWeatherForDate(city, country, date) {
        const targetDate = new Date(date);
        targetDate.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(targetDate);
        endOfDay.setDate(endOfDay.getDate() + 1);

        return await this.getWeatherForecast(city, country, targetDate, endOfDay);
    }

    /**
     * Process forecast data into structured format
     * @private
     */
    static _processForecastData(forecasts, cityInfo, startDate, endDate, durationDays) {
        if (!forecasts || forecasts.length === 0) {
            logger.warn('No forecast data available');
            return null;
        }

        // Group forecasts by day
        const dailyForecasts = this._groupForecastsByDay(forecasts);

        // Calculate overall summary
        const summary = this._calculateForecastSummary(forecasts);

        return {
            location: {
                city: cityInfo.name,
                country: cityInfo.country,
                coordinates: {
                    lat: cityInfo.coord.lat,
                    lon: cityInfo.coord.lon
                }
            },
            startDate,
            endDate,
            durationDays,
            summary,
            dailyForecasts,
            dataType: 'forecast',
            source: 'openweather',
            timestamp: new Date()
        };
    }

    /**
     * Group 3-hourly forecasts by day
     * @private
     */
    static _groupForecastsByDay(forecasts) {
        const grouped = {};

        forecasts.forEach(entry => {
            const date = new Date(entry.dt * 1000);
            const dayKey = date.toISOString().split('T')[0];

            if (!grouped[dayKey]) {
                grouped[dayKey] = [];
            }

            grouped[dayKey].push({
                time: date,
                temp: Math.round(entry.main.temp),
                feelsLike: Math.round(entry.main.feels_like),
                tempMin: Math.round(entry.main.temp_min),
                tempMax: Math.round(entry.main.temp_max),
                condition: entry.weather[0].main,
                description: entry.weather[0].description,
                icon: entry.weather[0].icon,
                humidity: entry.main.humidity,
                pressure: entry.main.pressure,
                windSpeed: entry.wind.speed,
                windDeg: entry.wind.deg,
                cloudiness: entry.clouds.all,
                precipitation: entry.pop * 100, // Probability of precipitation (%)
                rain: entry.rain?.['3h'] || 0,
                snow: entry.snow?.['3h'] || 0
            });
        });

        // Calculate daily summaries
        const dailySummaries = {};
        
        Object.keys(grouped).forEach(day => {
            const dayForecasts = grouped[day];
            const temps = dayForecasts.map(f => f.temp);
            const conditions = dayForecasts.map(f => f.condition);

            dailySummaries[day] = {
                date: new Date(day),
                tempMin: Math.min(...temps),
                tempMax: Math.max(...temps),
                tempAvg: Math.round(temps.reduce((a, b) => a + b, 0) / temps.length),
                dominantCondition: this._getMostFrequent(conditions),
                avgHumidity: Math.round(
                    dayForecasts.reduce((sum, f) => sum + f.humidity, 0) / dayForecasts.length
                ),
                avgWindSpeed: Math.round(
                    dayForecasts.reduce((sum, f) => sum + f.windSpeed, 0) / dayForecasts.length * 10
                ) / 10,
                maxPrecipitation: Math.max(...dayForecasts.map(f => f.precipitation)),
                totalRain: dayForecasts.reduce((sum, f) => sum + f.rain, 0),
                totalSnow: dayForecasts.reduce((sum, f) => sum + f.snow, 0),
                hourlyForecasts: dayForecasts // 3-hourly breakdown
            };
        });

        return dailySummaries;
    }

    /**
     * Calculate overall forecast summary
     * @private
     */
    static _calculateForecastSummary(forecasts) {
        const temps = forecasts.map(f => f.main.temp);
        const conditions = forecasts.map(f => f.weather[0].main);
        const precipitations = forecasts.map(f => (f.pop || 0) * 100);

        const avgTemp = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length);
        const tempMin = Math.round(Math.min(...temps));
        const tempMax = Math.round(Math.max(...temps));

        const rainEntries = forecasts.filter(f => 
            f.weather[0].main.toLowerCase().includes('rain')
        );
        const rainProbability = Math.round((rainEntries.length / forecasts.length) * 100);

        const snowEntries = forecasts.filter(f => 
            f.weather[0].main.toLowerCase().includes('snow')
        );
        const snowProbability = Math.round((snowEntries.length / forecasts.length) * 100);

        return {
            avgTemp,
            tempMin,
            tempMax,
            dominantCondition: this._getMostFrequent(conditions),
            rainProbability,
            snowProbability,
            avgPrecipitation: Math.round(
                precipitations.reduce((a, b) => a + b, 0) / precipitations.length
            ),
            avgHumidity: Math.round(
                forecasts.reduce((sum, f) => sum + f.main.humidity, 0) / forecasts.length
            ),
            avgWindSpeed: Math.round(
                forecasts.reduce((sum, f) => sum + (f.wind?.speed || 0), 0) / forecasts.length * 10
            ) / 10,
            totalForecasts: forecasts.length
        };
    }

    /**
     * Get climate data for dates beyond 5-day forecast
     * Uses historical climate averages
     * @private
     */
    static async _getClimateData(lat, lon, startDate, endDate) {
        // For dates beyond 5 days, we use climate averages
        // This provides reasonable estimates based on historical data
        
        logger.info('Fetching climate data for extended forecast', { lat, lon });

        try {
            // OpenWeather provides climate data but requires different API
            // For now, we'll use a simple approach with monthly averages
            // In production, you might want to use a climate database or API
            
            const month = startDate.getMonth(); // 0-11
            
            // These are rough global averages - in production, use actual climate data
            const climateAverages = this._getMonthlyClimateAverages(month, lat);
            
            return climateAverages;
            
        } catch (error) {
            logger.warn('Failed to fetch climate data, using fallback', {
                error: error.message
            });
            
            // Fallback to simple estimates
            return this._getMonthlyClimateAverages(startDate.getMonth(), lat);
        }
    }

    /**
     * Get monthly climate averages based on latitude
     * @private
     */
    static _getMonthlyClimateAverages(month, lat) {
        // Simple climate model based on latitude and month
        // In production, replace with actual climate database
        
        const isNorthernHemisphere = lat >= 0;
        
        // Adjust for hemisphere
        const adjustedMonth = isNorthernHemisphere ? month : (month + 6) % 12;
        
        // Temperature estimates (very simplified)
        const baseTemps = [5, 7, 12, 17, 22, 26, 28, 27, 23, 17, 11, 6];
        const basePrecip = [60, 50, 55, 50, 60, 70, 80, 75, 65, 70, 65, 65];
        
        return {
            avgTemp: baseTemps[adjustedMonth],
            avgPrecipitation: basePrecip[adjustedMonth],
            source: 'climate_average',
            reliability: 'low' // Indicate this is estimated
        };
    }

    /**
     * Combine 5-day forecast with climate data for extended trips
     * @private
     */
    static _combineWithClimateData(forecastData, climateData, totalDays) {
        const daysWithForecast = Object.keys(forecastData.dailyForecasts).length;
        const remainingDays = totalDays - daysWithForecast;
        
        logger.info('Combining forecast with climate data', {
            forecastDays: daysWithForecast,
            climateDays: remainingDays,
            totalDays
        });

        // Add climate-based estimates for remaining days
        const lastForecastDate = new Date(
            Math.max(...Object.keys(forecastData.dailyForecasts).map(d => new Date(d)))
        );

        for (let i = 1; i <= remainingDays; i++) {
            const estimateDate = new Date(lastForecastDate);
            estimateDate.setDate(estimateDate.getDate() + i);
            const dateKey = estimateDate.toISOString().split('T')[0];

            forecastData.dailyForecasts[dateKey] = {
                date: estimateDate,
                tempMin: climateData.avgTemp - 3,
                tempMax: climateData.avgTemp + 3,
                tempAvg: climateData.avgTemp,
                dominantCondition: 'Estimated',
                avgHumidity: 65,
                maxPrecipitation: climateData.avgPrecipitation,
                isEstimate: true,
                source: 'climate_average'
            };
        }

        // Update summary to reflect full trip
        forecastData.durationDays = totalDays;
        forecastData.hasEstimates = true;
        forecastData.forecastDays = daysWithForecast;
        forecastData.estimatedDays = remainingDays;
        
        return forecastData;
    }

    /**
     * Get most frequent item in array
     * @private
     */
    static _getMostFrequent(array) {
        const counts = {};
        array.forEach(item => {
            counts[item] = (counts[item] || 0) + 1;
        });
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }

    /**
     * Centralized error handling
     * @private
     */
    static _handleError(error, city, country, operation) {
        logger.error(`Error in ${operation}:`, {
            error: error.message,
            city,
            country,
            response: error.response?.data
        });

        if (error.response?.status === 404) {
            throw new Error(`Location not found: ${city}, ${country}`);
        } else if (error.response?.status === 401) {
            throw new Error('Invalid weather API key. Please check WEATHER_API_KEY in environment variables');
        } else if (error.code === 'ECONNABORTED') {
            throw new Error('Weather service timeout. Please try again');
        } else if (error.response?.status === 429) {
            throw new Error('Weather API rate limit exceeded. Please try again later');
        }

        throw new Error(`Failed to fetch ${operation}: ${error.message}`);
    }

    /**
     * Clear weather cache (useful for testing or manual refresh)
     */
    static clearCache() {
        weatherCache.clear();
        logger.info('Weather cache cleared');
    }

    /**
     * Get cache statistics
     */
    static getCacheStats() {
        return {
            size: weatherCache.size,
            entries: Array.from(weatherCache.keys()),
            cacheHitRate: this._calculateCacheHitRate()
        };
    }

    /**
     * Calculate cache hit rate
     * @private
     */
    static _calculateCacheHitRate() {
        // Simple implementation - in production, track hits/misses
        return weatherCache.size > 0 ? 'Active' : 'Empty';
    }

    /**
 * Get multi-day weather forecast for trips
 * @param {string} city - City name
 * @param {string} country - Country code
 * @param {Date|string} startDate - Trip start
 * @param {Date|string} endDate - Trip end
 * @returns {Array} Array of daily weather
 */
static async getMultiDayWeatherForTrip(city, country, startDate, endDate) {
    try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const durationDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

        logger.info('Fetching multi-day weather for trip', { city, country, days: durationDays });

        // Use your existing getWeatherForecast method
        const forecastData = await this.getWeatherForecast(city, country, startDate, endDate);

        if (!forecastData || !forecastData.dailyForecasts) {
            logger.warn('No forecast data available');
            return this._generateFallbackWeatherArray(start, end);
        }

        // Convert to array format for packaging service
        const dailyWeatherArray = [];
        const dailyForecasts = forecastData.dailyForecasts;

        for (let i = 0; i < durationDays; i++) {
            const date = new Date(start);
            date.setDate(date.getDate() + i);
            const dateKey = date.toISOString().split('T')[0];

            const dayForecast = dailyForecasts[dateKey];

            if (dayForecast) {
                dailyWeatherArray.push({
                    date: dateKey,
                    temp: dayForecast.tempAvg,
                    tempMin: dayForecast.tempMin,
                    tempMax: dayForecast.tempMax,
                    feelsLike: dayForecast.tempAvg,
                    condition: dayForecast.dominantCondition,
                    description: dayForecast.dominantCondition,
                    humidity: dayForecast.avgHumidity,
                    windSpeed: dayForecast.avgWindSpeed,
                    precipitation: dayForecast.maxPrecipitation / 100, // Convert to 0-1
                    uvIndex: 5, // Default
                    visibility: 10000,
                    forecastAccuracy: i < 3 ? 'high' : (dayForecast.isEstimate ? 'low' : 'medium'),
                    forecastType: dayForecast.isEstimate ? 'climate-average' : 'specific'
                });
            } else {
                // Fallback for missing data
                dailyWeatherArray.push(this._generateFallbackWeatherForDate(date));
            }
        }

        return dailyWeatherArray;

    } catch (error) {
        logger.error('Multi-day weather fetch failed', { error: error.message });
        return this._generateFallbackWeatherArray(startDate, endDate);
    }
}

/**
 * Generate fallback weather array
 * @private
 */
static _generateFallbackWeatherArray(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const durationDays = Math.ceil((end - start) / (1000 * 60 * 60 * 1000));
    const weatherArray = [];

    for (let i = 0; i < durationDays; i++) {
        const date = new Date(start);
        date.setDate(date.getDate() + i);
        weatherArray.push(this._generateFallbackWeatherForDate(date));
    }

    return weatherArray;
}

/**
 * Generate fallback weather for single date
 * @private
 */
static _generateFallbackWeatherForDate(date) {
    const month = date.getMonth();
    const seasonalTemp = this._getSeasonalTemp(month);

    return {
        date: date.toISOString().split('T')[0],
        temp: seasonalTemp,
        tempMin: seasonalTemp - 3,
        tempMax: seasonalTemp + 3,
        feelsLike: seasonalTemp,
        condition: 'partly cloudy',
        description: 'Seasonal average',
        humidity: 60,
        windSpeed: 10,
        precipitation: 0.2,
        uvIndex: 5,
        visibility: 10000,
        forecastAccuracy: 'fallback',
        forecastType: 'seasonal-average'
    };
}

/**
 * Get seasonal temperature
 * @private
 */
static _getSeasonalTemp(month) {
    const temps = [5, 7, 10, 15, 20, 25, 28, 27, 22, 16, 10, 6];
    return temps[month] || 18;
}
}

// Validate API key on module load
WeatherService.validateApiKey();

module.exports = WeatherService;