import { NextRequest, NextResponse } from "next/server";

export interface CurrentWeather {
  city: string;
  country: string;
  coord: { lat: number; lon: number };
  temp: number;
  feels_like: number;
  temp_min: number;
  temp_max: number;
  humidity: number;
  pressure: number;
  visibility: number;
  windSpeed: number;
  windDeg: number;
  condition: string;
  description: string;
  icon: string;
  clouds: number;
  sunrise: number;
  sunset: number;
  timezone: number;
  dt: number;
}

export interface ForecastItem {
  dt: number;
  dateText: string;
  temp: number;
  temp_min: number;
  temp_max: number;
  condition: string;
  description: string;
  icon: string;
  humidity: number;
  windSpeed: number;
  pop: number; // probability of precipitation
}

export interface WeatherApiResponse {
  current: CurrentWeather;
  forecast: ForecastItem[];
  source: "live" | "demo";
  warning?: string;
}

// Helper to generate realistic demo weather for any queried location
function generateDemoWeather(
  cityQuery: string,
  units: "metric" | "imperial"
): { current: CurrentWeather; forecast: ForecastItem[] } {
  const cityName = cityQuery
    ? cityQuery.charAt(0).toUpperCase() + cityQuery.slice(1).toLowerCase()
    : "London";
  const isMetric = units === "metric";

  // Deterministic seed based on city name string
  let hash = 0;
  for (let i = 0; i < cityName.length; i++) {
    hash = (hash << 5) - hash + cityName.charCodeAt(i);
    hash |= 0;
  }
  const absHash = Math.abs(hash);

  const conditions = [
    { main: "Clear", desc: "clear sky", icon: "01d" },
    { main: "Clouds", desc: "few clouds", icon: "02d" },
    { main: "Clouds", desc: "scattered clouds", icon: "03d" },
    { main: "Rain", desc: "light rain", icon: "10d" },
    { main: "Thunderstorm", desc: "thunderstorm with rain", icon: "11d" },
    { main: "Snow", desc: "light snow", icon: "13d" },
  ];
  const selectedCond = conditions[absHash % conditions.length];

  const baseTempC = 12 + (absHash % 16); // 12°C - 28°C
  const currentTemp = isMetric ? baseTempC : Math.round((baseTempC * 9) / 5 + 32);
  const feelsLike = isMetric
    ? baseTempC - 1 + (absHash % 3)
    : Math.round(((baseTempC - 1) * 9) / 5 + 32);
  const tempMin = currentTemp - 3;
  const tempMax = currentTemp + 4;

  const now = Math.floor(Date.now() / 1000);
  const todayMorning = Math.floor(new Date().setHours(6, 15, 0, 0) / 1000);
  const todayEvening = Math.floor(new Date().setHours(18, 45, 0, 0) / 1000);

  const current: CurrentWeather = {
    city: cityName,
    country: "DEMO",
    coord: { lat: 51.5074, lon: -0.1278 },
    temp: currentTemp,
    feels_like: feelsLike,
    temp_min: tempMin,
    temp_max: tempMax,
    humidity: 50 + (absHash % 40),
    pressure: 1010 + (absHash % 15),
    visibility: 10000,
    windSpeed: isMetric ? 3.5 + (absHash % 8) : 5 + (absHash % 12),
    windDeg: (absHash * 37) % 360,
    condition: selectedCond.main,
    description: selectedCond.desc,
    icon: selectedCond.icon,
    clouds: (absHash % 70) + 10,
    sunrise: todayMorning,
    sunset: todayEvening,
    timezone: 0,
    dt: now,
  };

  const forecast: ForecastItem[] = [];
  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = new Date();

  for (let i = 1; i <= 5; i++) {
    const fDate = new Date(today);
    fDate.setDate(today.getDate() + i);
    const dayCond = conditions[(absHash + i * 2) % conditions.length];
    const dayTemp = currentTemp + ((i % 3) - 1) * 2;

    forecast.push({
      dt: Math.floor(fDate.getTime() / 1000),
      dateText: `${daysOfWeek[fDate.getDay()]}, ${fDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      temp: dayTemp,
      temp_min: dayTemp - 3,
      temp_max: dayTemp + 3,
      condition: dayCond.main,
      description: dayCond.desc,
      icon: dayCond.icon,
      humidity: 45 + ((absHash + i * 7) % 45),
      windSpeed: isMetric ? 3 + (i % 5) : 5 + (i % 8),
      pop: ((absHash + i * 15) % 100) / 100,
    });
  }

  return { current, forecast };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get("q")?.trim() || "";
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const unitsParam = (searchParams.get("units") as "metric" | "imperial") || "metric";
  const forceDemo = searchParams.get("demo") === "true";

  // Read API key strictly from environment (.env)
  const apiKey = process.env.OPENWEATHER_API_KEY?.trim() || "";

  if (!city && (!lat || !lon)) {
    return NextResponse.json(
      { error: "Please provide a city name (q) or coordinates (lat, lon)." },
      { status: 400 }
    );
  }

  const locationQuery = city || `${lat},${lon}`;

  // If user requested demo explicitly, return demo directly
  if (forceDemo) {
    const demoData = generateDemoWeather(locationQuery, unitsParam);
    return NextResponse.json<WeatherApiResponse>({
      current: demoData.current,
      forecast: demoData.forecast,
      source: "demo",
      warning: "Showing demo simulated data.",
    });
  }

  // If no API key configured
  if (!apiKey) {
    const demoData = generateDemoWeather(locationQuery, unitsParam);
    return NextResponse.json<WeatherApiResponse>({
      current: demoData.current,
      forecast: demoData.forecast,
      source: "demo",
      warning: "No OpenWeather API key found in .env. Showing simulated demo data.",
    });
  }

  // Build OpenWeather URLs
  const baseUrl = "https://api.openweathermap.org/data/2.5";
  const queryParam = city
    ? `q=${encodeURIComponent(city)}`
    : `lat=${encodeURIComponent(lat!)}&lon=${encodeURIComponent(lon!)}`;

  const weatherUrl = `${baseUrl}/weather?${queryParam}&appid=${apiKey}&units=${unitsParam}`;
  const forecastUrl = `${baseUrl}/forecast?${queryParam}&appid=${apiKey}&units=${unitsParam}`;

  try {
    const [weatherRes, forecastRes] = await Promise.all([
      fetch(weatherUrl, { next: { revalidate: 60 } }),
      fetch(forecastUrl, { next: { revalidate: 120 } }),
    ]);

    const weatherData = await weatherRes.json();

    // Check if OpenWeather reported an error
    if (!weatherRes.ok || weatherData.cod !== 200) {
      const is401 = weatherRes.status === 401 || weatherData.cod === 401 || weatherData.cod === "401";
      const is404 = weatherRes.status === 404 || weatherData.cod === 404 || weatherData.cod === "404";

      let reason = weatherData.message || "Failed to fetch weather data from OpenWeather.";
      let keyHint = "";

      if (is401) {
        keyHint =
          apiKey.length === 31
            ? `Your OpenWeather API key has 31 characters, while standard keys are 32 hexadecimal characters. Also, new keys take 10-60 minutes to activate after account creation.`
            : `OpenWeather returned 401 Unauthorized. Newly generated API keys can take 10-60 minutes to activate.`;
        reason = `${weatherData.message || "Invalid API key"}. ${keyHint}`;
      } else if (is404) {
        return NextResponse.json(
          { error: `Location "${city}" not found. Please check spelling.` },
          { status: 404 }
        );
      }

      // Return demo data with explanation so the UI remains interactive
      const demoData = generateDemoWeather(locationQuery, unitsParam);
      return NextResponse.json<WeatherApiResponse>({
        current: demoData.current,
        forecast: demoData.forecast,
        source: "demo",
        warning: reason,
      });
    }

    interface RawForecastItem {
      dt: number;
      dt_txt?: string;
      main: {
        temp: number;
        temp_min: number;
        temp_max: number;
        humidity: number;
      };
      weather?: Array<{
        main?: string;
        description?: string;
        icon?: string;
      }>;
      wind?: {
        speed?: number;
      };
      pop?: number;
    }

    // Process forecast data
    const forecastItems: ForecastItem[] = [];
    if (forecastRes.ok) {
      const forecastJson = await forecastRes.json();
      if (Array.isArray(forecastJson.list)) {
        // Group by day - take 1 reading per 24 hours (around 12:00 or closest)
        const dailyMap = new Map<string, RawForecastItem>();
        for (const item of forecastJson.list as RawForecastItem[]) {
          const dateStr = item.dt_txt?.split(" ")[0] || new Date(item.dt * 1000).toISOString().split("T")[0];
          const isMidday = item.dt_txt?.includes("12:00:00");
          if (!dailyMap.has(dateStr) || isMidday) {
            dailyMap.set(dateStr, item);
          }
        }

        const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        for (const [, item] of dailyMap.entries()) {
          const dateObj = new Date(item.dt * 1000);
          forecastItems.push({
            dt: item.dt,
            dateText: `${daysOfWeek[dateObj.getDay()]}, ${dateObj.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
            temp: Math.round(item.main.temp),
            temp_min: Math.round(item.main.temp_min),
            temp_max: Math.round(item.main.temp_max),
            condition: item.weather?.[0]?.main || "Clear",
            description: item.weather?.[0]?.description || "",
            icon: item.weather?.[0]?.icon || "01d",
            humidity: item.main.humidity,
            windSpeed: item.wind?.speed || 0,
            pop: item.pop || 0,
          });
        }
      }
    }

    const current: CurrentWeather = {
      city: weatherData.name,
      country: weatherData.sys?.country || "",
      coord: weatherData.coord || { lat: 0, lon: 0 },
      temp: Math.round(weatherData.main.temp),
      feels_like: Math.round(weatherData.main.feels_like),
      temp_min: Math.round(weatherData.main.temp_min),
      temp_max: Math.round(weatherData.main.temp_max),
      humidity: weatherData.main.humidity,
      pressure: weatherData.main.pressure,
      visibility: weatherData.visibility || 10000,
      windSpeed: weatherData.wind?.speed || 0,
      windDeg: weatherData.wind?.deg || 0,
      condition: weatherData.weather?.[0]?.main || "Clear",
      description: weatherData.weather?.[0]?.description || "",
      icon: weatherData.weather?.[0]?.icon || "01d",
      clouds: weatherData.clouds?.all || 0,
      sunrise: weatherData.sys?.sunrise || 0,
      sunset: weatherData.sys?.sunset || 0,
      timezone: weatherData.timezone || 0,
      dt: weatherData.dt,
    };

    return NextResponse.json<WeatherApiResponse>({
      current,
      forecast: forecastItems.slice(0, 5),
      source: "live",
    });
  } catch (err: unknown) {
    console.error("Weather fetch error:", err);
    const errorMessage = err instanceof Error ? err.message : "Failed to reach weather service";
    // Fall back to demo data so app is not broken by connectivity drops
    const demoData = generateDemoWeather(locationQuery, unitsParam);
    return NextResponse.json<WeatherApiResponse>({
      current: demoData.current,
      forecast: demoData.forecast,
      source: "demo",
      warning: `Network/API error: ${errorMessage}. Showing demo data.`,
    });
  }
}
