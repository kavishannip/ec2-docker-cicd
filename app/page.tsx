"use client";

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useSyncExternalStore,
  useRef,
  FormEvent,
} from "react";
import Image from "next/image";
import { WeatherApiResponse } from "./api/weather/route";

interface CityPreset {
  name: string;
  country: string;
  timezoneOffset: number; // in seconds
}

const INITIAL_CITIES: CityPreset[] = [
  { name: "Los Angeles", country: "US", timezoneOffset: -25200 },
  { name: "New York", country: "US", timezoneOffset: -14400 },
  { name: "London", country: "GB", timezoneOffset: 3600 },
  { name: "Paris", country: "FR", timezoneOffset: 7200 },
  { name: "Tokyo", country: "JP", timezoneOffset: 32400 },
];

// External store listeners and snapshots for SSR-safe localStorage sync
function subscribeToLocalStorage(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("local-storage-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("local-storage-change", callback);
  };
}

function getRecentSearchesSnapshot(): string {
  if (typeof window === "undefined") return "[]";
  try {
    return localStorage.getItem("weather_recent_searches") || "[]";
  } catch {
    return "[]";
  }
}

function getRecentSearchesServerSnapshot(): string {
  return "[]";
}

// Convert 2-letter country code to full English country name
function getCountryFullName(countryCode?: string): string {
  if (!countryCode) return "";
  try {
    const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(countryCode) || countryCode;
  } catch {
    return countryCode;
  }
}

export default function Home() {
  const [cityInput, setCityInput] = useState("");
  const [activeCity, setActiveCity] = useState("London");
  const [units, setUnits] = useState<"metric" | "imperial">("metric");
  const [is24Hour, setIs24Hour] = useState(false);
  const [weatherData, setWeatherData] = useState<WeatherApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [citiesList, setCitiesList] = useState<CityPreset[]>(INITIAL_CITIES);
  const [nowMs, setNowMs] = useState<number | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // useSyncExternalStore guarantees SSR snapshot matches server
  const recentSearchesRaw = useSyncExternalStore(
    subscribeToLocalStorage,
    getRecentSearchesSnapshot,
    getRecentSearchesServerSnapshot
  );

  const recentSearches = useMemo(() => {
    try {
      const parsed = JSON.parse(recentSearchesRaw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [recentSearchesRaw]);

  const saveRecentSearch = useCallback((name: string) => {
    if (typeof window === "undefined") return;
    try {
      const current = JSON.parse(
        localStorage.getItem("weather_recent_searches") || "[]"
      ) as string[];
      const filtered = current.filter(
        (c) => c.toLowerCase() !== name.toLowerCase()
      );
      const updated = [name, ...filtered].slice(0, 6);
      localStorage.setItem("weather_recent_searches", JSON.stringify(updated));
      window.dispatchEvent(new Event("local-storage-change"));
    } catch {
      // Ignore
    }
  }, []);

  // Update clock after client mount (defer reading dynamic time)
  useEffect(() => {
    const timer = setTimeout(() => {
      setNowMs(Date.now());
    }, 0);
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  const fetchWeather = useCallback(
    async (
      params: { q?: string; lat?: number; lon?: number },
      overrideUnits?: "metric" | "imperial"
    ) => {
      setIsLoading(true);
      setErrorMessage(null);

      const targetUnits = overrideUnits || units;

      try {
        const queryParams = new URLSearchParams({
          units: targetUnits,
        });

        if (params.q) {
          queryParams.set("q", params.q);
        } else if (params.lat !== undefined && params.lon !== undefined) {
          queryParams.set("lat", params.lat.toString());
          queryParams.set("lon", params.lon.toString());
        }

        const res = await fetch(`/api/weather?${queryParams.toString()}`);
        const data = (await res.json()) as WeatherApiResponse & { error?: string };

        if (!res.ok) {
          setErrorMessage(data.error || "Failed to fetch weather data.");
          setIsLoading(false);
          return;
        }

        setWeatherData(data);

        if (data.current?.city) {
          const cityName = data.current.city;
          setActiveCity(cityName);
          saveRecentSearch(cityName);

          // Update or add city to preset list
          setCitiesList((prev) => {
            const exists = prev.some(
              (c) => c.name.toLowerCase() === cityName.toLowerCase()
            );
            if (exists) {
              return prev.map((c) =>
                c.name.toLowerCase() === cityName.toLowerCase()
                  ? {
                      ...c,
                      country: data.current.country,
                      timezoneOffset: data.current.timezone,
                    }
                  : c
              );
            }
            return [
              ...prev,
              {
                name: cityName,
                country: data.current.country,
                timezoneOffset: data.current.timezone,
              },
            ];
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
        setErrorMessage(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [units, saveRecentSearch]
  );

  // Initial load on mount
  useEffect(() => {
    let isMounted = true;
    async function loadInitial() {
      try {
        const queryParams = new URLSearchParams({
          q: "London",
          units: "metric",
        });
        const res = await fetch(`/api/weather?${queryParams.toString()}`);
        const data = await res.json();
        if (!isMounted) return;
        if (res.ok) {
          setWeatherData(data);
          if (data.current?.city) {
            saveRecentSearch(data.current.city);
          }
        } else {
          setErrorMessage(data.error || "Failed to load initial weather data.");
        }
      } catch (err: unknown) {
        if (isMounted) {
          setErrorMessage(
            err instanceof Error ? err.message : "Could not connect to weather service."
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadInitial();
    return () => {
      isMounted = false;
    };
  }, [saveRecentSearch]);

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    const query = cityInput.trim();
    if (!query) return;
    fetchWeather({ q: query });
    setCityInput("");
  };

  const handleCityCardClick = (cityName: string) => {
    setActiveCity(cityName);
    fetchWeather({ q: cityName });
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setErrorMessage("Geolocation is not supported by your browser.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        fetchWeather({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      },
      (err) => {
        setIsLoading(false);
        setErrorMessage(
          err.code === 1
            ? "Location permission denied. Please search by city name."
            : "Could not retrieve location. Please search by city name."
        );
      },
      { timeout: 10000 }
    );
  };

  const handleUnitsChange = (newUnits: "metric" | "imperial") => {
    if (newUnits === units) return;
    setUnits(newUnits);
    fetchWeather({ q: activeCity }, newUnits);
  };

  // Time calculations
  const getTimeForOffset = useCallback(
    (offsetSeconds: number, includeSeconds: boolean = true) => {
      if (nowMs === null) {
        return includeSeconds ? "08:15:40" : "08:15";
      }
      const now = new Date(nowMs);
      const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
      const cityDate = new Date(utcMs + offsetSeconds * 1000);

      let hours = cityDate.getHours();
      const minutes = cityDate.getMinutes();
      const seconds = cityDate.getSeconds();

      if (!is24Hour) {
        hours = hours % 12 || 12;
      }

      const pad = (n: number) => n.toString().padStart(2, "0");
      if (includeSeconds) {
        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
      }
      return `${pad(hours)}:${pad(minutes)}`;
    },
    [nowMs, is24Hour]
  );

  const isDayTime = useCallback(
    (offsetSeconds: number, sunrise?: number, sunset?: number) => {
      if (nowMs === null) {
        return true;
      }
      if (sunrise && sunset) {
        const nowSec = Math.floor(nowMs / 1000);
        return nowSec >= sunrise && nowSec < sunset;
      }
      const now = new Date(nowMs);
      const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
      const cityDate = new Date(utcMs + offsetSeconds * 1000);
      const h = cityDate.getHours();
      return h >= 6 && h < 19;
    },
    [nowMs]
  );

  const formatUtcOffset = (offsetSeconds: number) => {
    const hours = Math.round(offsetSeconds / 3600);
    return hours >= 0 ? `UTC+${hours}` : `UTC${hours}`;
  };

  const current = weatherData?.current;
  const forecast = weatherData?.forecast || [];
  const tempUnit = units === "metric" ? "°C" : "°F";
  const speedUnit = units === "metric" ? "m/s" : "mph";

  const activeTimezoneOffset = current?.timezone ?? 3600;
  const heroTime = getTimeForOffset(activeTimezoneOffset, true);

  // Format Sunrise, Sunset and Duration
  const sunInfo = (() => {
    if (!current?.sunrise || !current?.sunset) return null;
    const pad = (n: number) => n.toString().padStart(2, "0");
    const riseDate = new Date((current.sunrise + activeTimezoneOffset) * 1000);
    const setDate = new Date((current.sunset + activeTimezoneOffset) * 1000);

    const riseStr = `${pad(riseDate.getUTCHours())}:${pad(riseDate.getUTCMinutes())}`;
    const setStr = `${pad(setDate.getUTCHours())}:${pad(setDate.getUTCMinutes())}`;

    const diffMinutes = Math.max(0, Math.floor((current.sunset - current.sunrise) / 60));
    const diffH = Math.floor(diffMinutes / 60);
    const diffM = diffMinutes % 60;

    return `Sun ☀️ : ${riseStr} - ${setStr} (${diffH}h ${pad(diffM)}m)`;
  })();

  // Current formatted date for active city
  const cityLocalDate = (() => {
    if (nowMs === null) {
      return "Monday, Mar 24, 2025";
    }
    const now = new Date(nowMs);
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const cityDate = new Date(utcMs + activeTimezoneOffset * 1000);

    return cityDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  })();

  return (
    <div className="min-h-screen bg-[#ECEEED] text-[#0A0B0D] flex flex-col font-sans selection:bg-black selection:text-white">
      {/* Top Navigation */}
      <header className="border-b border-black/[0.06] bg-[#ECEEED]/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => fetchWeather({ q: "London" })}>
            <div className="w-8 h-8 rounded-full bg-[#0A0B0D] text-white flex items-center justify-center shadow-sm">
              <svg
                className="w-4 h-4 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 6 12 12 15 15" />
              </svg>
            </div>
            <span className="font-bold text-lg tracking-tight text-[#0A0B0D]">TimeSpot</span>
          </div>

          {/* Search Bar */}
          <form
            onSubmit={handleSearchSubmit}
            className="flex-1 max-w-md mx-2 relative"
            role="search"
          >
            <div className="relative flex items-center">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <input
                ref={searchInputRef}
                type="search"
                value={cityInput}
                onChange={(e) => setCityInput(e.target.value)}
                placeholder="Search city or country..."
                enterKeyHint="search"
                autoComplete="off"
                className="w-full bg-[#E2E4E3] hover:bg-[#D9DCDB] focus:bg-white text-[#0A0B0D] placeholder-neutral-500 text-sm rounded-full pl-9 pr-8 py-2 border border-transparent focus:border-black/20 focus:outline-none transition-all"
              />
              {cityInput && (
                <button
                  type="button"
                  onClick={() => setCityInput("")}
                  className="absolute right-3 text-neutral-400 hover:text-black text-xs p-1"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
          </form>

          {/* Right Action Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleUseCurrentLocation}
              disabled={isLoading}
              title="Use current location"
              type="button"
              className="text-xs font-semibold text-neutral-600 hover:text-black flex items-center gap-1.5 transition-colors px-2 py-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="hidden sm:inline">My Location</span>
            </button>

            <button
              type="button"
              onClick={() => fetchWeather({ q: activeCity })}
              className="bg-[#0A0B0D] hover:bg-neutral-800 text-white text-xs font-semibold px-4 py-2 rounded-full transition-all shadow-sm flex items-center gap-1.5"
            >
              <span>{isLoading ? "Updating..." : "Live Weather"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-8 sm:py-12 flex flex-col">
        {/* Notice banner if simulated/fallback mode active */}
        {weatherData?.warning && (
          <div className="mb-6 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-center gap-3 text-sm text-amber-900">
            <span className="text-xl">⚠️</span>
            <div className="flex-1">
              <p className="font-semibold text-amber-950">OpenWeather Service Notice</p>
              <p className="text-xs text-amber-900/80 mt-0.5">{weatherData.warning}</p>
            </div>
          </div>
        )}

        {/* Error message banner */}
        {errorMessage && (
          <div className="mb-6 bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 text-rose-950 text-sm flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-xl">⚠️</span>
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-rose-700 hover:text-rose-950 text-xs font-semibold underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Giant Hero Time Display */}
        <section aria-label="Current Time" className="flex flex-col items-center justify-center my-6 sm:my-10 text-center">
          <div
            className="text-[4.75rem] sm:text-[7.5rem] md:text-[10rem] lg:text-[13rem] font-black tracking-tighter text-[#0A0B0D] leading-none select-none font-mono"
            suppressHydrationWarning
          >
            {heroTime || "00:00:00"}
          </div>

          {/* Subline under Giant Display */}
          <div className="w-full mt-4 sm:mt-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-medium text-neutral-600 border-t border-black/[0.08] pt-4">
            {/* Left: Weather condition snippet */}
            <div className="flex items-center gap-2">
              <span className="uppercase tracking-wider font-bold text-neutral-400">Current</span>
              {current ? (
                <span className="font-semibold text-neutral-900 capitalize">
                  {current.description} • {current.temp}
                  {tempUnit} (Feels {current.feels_like}
                  {tempUnit})
                </span>
              ) : (
                <span>Loading conditions...</span>
              )}
            </div>

            {/* Center: Sun Hours + Date */}
            <div className="flex flex-col items-center text-center">
              {sunInfo && (
                <span className="font-medium text-neutral-800">{sunInfo}</span>
              )}
              <span className="text-neutral-500 font-normal mt-0.5" suppressHydrationWarning>
                {cityLocalDate}
              </span>
            </div>

            {/* Right: Toggle Pills (12h/24h and °C/°F) */}
            <div className="flex items-center gap-2">
              {/* Unit Toggle */}
              <div className="inline-flex bg-[#DCDEDD] p-0.5 rounded-full">
                <button
                  type="button"
                  onClick={() => handleUnitsChange("metric")}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                    units === "metric"
                      ? "bg-[#0A0B0D] text-white shadow-sm"
                      : "text-neutral-600 hover:text-black"
                  }`}
                >
                  °C
                </button>
                <button
                  type="button"
                  onClick={() => handleUnitsChange("imperial")}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                    units === "imperial"
                      ? "bg-[#0A0B0D] text-white shadow-sm"
                      : "text-neutral-600 hover:text-black"
                  }`}
                >
                  °F
                </button>
              </div>

              {/* 12h / 24h Toggle */}
              <div className="inline-flex bg-[#DCDEDD] p-0.5 rounded-full">
                <button
                  type="button"
                  onClick={() => setIs24Hour(false)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                    !is24Hour
                      ? "bg-[#0A0B0D] text-white shadow-sm"
                      : "text-neutral-600 hover:text-black"
                  }`}
                >
                  12h
                </button>
                <button
                  type="button"
                  onClick={() => setIs24Hour(true)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                    is24Hour
                      ? "bg-[#0A0B0D] text-white shadow-sm"
                      : "text-neutral-600 hover:text-black"
                  }`}
                >
                  24h
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Large City Header Section */}
        <section aria-label="Selected Location" className="flex flex-col md:flex-row md:items-end justify-between gap-6 mt-6 sm:mt-12 mb-8">
          <div>
            <h2 className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-[#0A0B0D] leading-[1.05]">
              {current?.city || activeCity},
              <br />
              <span className="text-neutral-800 font-normal">
                {current?.country ? getCountryFullName(current.country) : "World"}
              </span>
            </h2>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            <p className="text-xs sm:text-sm text-neutral-500 max-w-xs font-normal leading-relaxed">
              Life moves fast. Stay on time, ahead of the weather, and enjoy every moment!
            </p>

            <button
              type="button"
              onClick={() => {
                searchInputRef.current?.focus();
                searchInputRef.current?.scrollIntoView({ behavior: "smooth" });
              }}
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#0A0B0D] hover:text-neutral-600 transition-colors self-start sm:self-auto cursor-pointer"
            >
              <span>Add Another City</span>
              <span className="w-5 h-5 rounded-full border border-black flex items-center justify-center text-xs font-bold leading-none">
                +
              </span>
            </button>
          </div>
        </section>

        {/* City Cards Grid (Inspiration Row) */}
        <section aria-label="World Cities Time and Weather" className="mb-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {citiesList.map((city) => {
              const isActive = activeCity.toLowerCase() === city.name.toLowerCase();
              const cityTimeStr = getTimeForOffset(city.timezoneOffset, false);
              const dayTime = isDayTime(
                city.timezoneOffset,
                isActive ? current?.sunrise : undefined,
                isActive ? current?.sunset : undefined
              );

              return (
                <button
                  key={city.name}
                  type="button"
                  onClick={() => handleCityCardClick(city.name)}
                  className={`text-left p-6 rounded-3xl transition-all duration-300 flex flex-col justify-between min-h-[160px] cursor-pointer ${
                    isActive
                      ? "bg-[#0A0B0D] text-white shadow-2xl scale-[1.02] ring-2 ring-black/10"
                      : "bg-[#F3F4F5] hover:bg-white text-[#0A0B0D] border border-black/[0.05] hover:shadow-lg"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-bold text-base tracking-tight truncate max-w-[110px]">
                      {city.name}
                    </span>
                    <span
                      className={`text-xs font-mono font-medium ${
                        isActive ? "text-neutral-400" : "text-neutral-500"
                      }`}
                    >
                      {formatUtcOffset(city.timezoneOffset)}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between w-full mt-6">
                    <span
                      className="text-3xl sm:text-4xl font-black tracking-tight font-mono"
                      suppressHydrationWarning
                    >
                      {cityTimeStr}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">{dayTime ? "☀️" : "🌙"}</span>
                      <span
                        className={`text-xs font-semibold ${
                          isActive ? "text-neutral-200" : "text-neutral-700"
                        }`}
                      >
                        {dayTime ? "Day" : "Night"}
                      </span>
                    </div>
                  </div>

                  {/* Temperature & Condition summary on card */}
                  <div
                    className={`mt-4 pt-3 border-t text-xs flex items-center justify-between font-medium ${
                      isActive
                        ? "border-white/10 text-neutral-300"
                        : "border-black/[0.06] text-neutral-500"
                    }`}
                  >
                    <span>
                      {isActive && current
                        ? `${current.temp}${tempUnit} • ${current.condition}`
                        : "Select city"}
                    </span>
                    {isActive && current && (
                      <span className="opacity-80">H:{current.temp_max}° L:{current.temp_min}°</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Recent Searches Pills */}
          {recentSearches.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-4 text-xs text-neutral-500">
              <span className="font-medium">Recent searches:</span>
              {recentSearches.map((name) => (
                <button
                  key={`recent-${name}`}
                  type="button"
                  onClick={() => handleCityCardClick(name)}
                  className="px-3 py-1 rounded-full bg-[#E2E4E3] hover:bg-[#D4D7D6] text-neutral-800 transition-colors"
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Detailed Weather Metrics & 5-Day Outlook */}
        {current && (
          <section aria-label="Detailed Weather and Forecast" className="flex flex-col gap-8 pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold tracking-tight text-[#0A0B0D]">
                Weather Outlook &amp; Metrics
              </h3>
              <span className="text-xs text-neutral-500">
                Data: {weatherData?.source === "live" ? "OpenWeather API" : "Simulated Forecast"}
              </span>
            </div>

            {/* Weather Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {/* Temperature Tile */}
              <div className="bg-[#F3F4F5] border border-black/[0.05] p-5 rounded-3xl flex flex-col justify-between">
                <span className="text-xs font-semibold text-neutral-500 uppercase">Feels Like</span>
                <span className="text-3xl font-extrabold text-[#0A0B0D] mt-3">
                  {current.feels_like}{tempUnit}
                </span>
                <span className="text-[11px] text-neutral-400 mt-1">Actual: {current.temp}{tempUnit}</span>
              </div>

              {/* Humidity Tile */}
              <div className="bg-[#F3F4F5] border border-black/[0.05] p-5 rounded-3xl flex flex-col justify-between">
                <span className="text-xs font-semibold text-neutral-500 uppercase">Humidity</span>
                <span className="text-3xl font-extrabold text-[#0A0B0D] mt-3">
                  {current.humidity}%
                </span>
                <span className="text-[11px] text-neutral-400 mt-1">
                  {current.humidity > 60 ? "Moist air" : "Comfortable"}
                </span>
              </div>

              {/* Wind Speed Tile */}
              <div className="bg-[#F3F4F5] border border-black/[0.05] p-5 rounded-3xl flex flex-col justify-between">
                <span className="text-xs font-semibold text-neutral-500 uppercase">Wind</span>
                <span className="text-3xl font-extrabold text-[#0A0B0D] mt-3">
                  {current.windSpeed} <span className="text-sm font-normal">{speedUnit}</span>
                </span>
                <span className="text-[11px] text-neutral-400 mt-1">Heading: {current.windDeg}°</span>
              </div>

              {/* Air Pressure Tile */}
              <div className="bg-[#F3F4F5] border border-black/[0.05] p-5 rounded-3xl flex flex-col justify-between">
                <span className="text-xs font-semibold text-neutral-500 uppercase">Pressure</span>
                <span className="text-3xl font-extrabold text-[#0A0B0D] mt-3">
                  {current.pressure}
                </span>
                <span className="text-[11px] text-neutral-400 mt-1">hPa (Sea level)</span>
              </div>

              {/* Visibility Tile */}
              <div className="bg-[#F3F4F5] border border-black/[0.05] p-5 rounded-3xl flex flex-col justify-between">
                <span className="text-xs font-semibold text-neutral-500 uppercase">Visibility</span>
                <span className="text-3xl font-extrabold text-[#0A0B0D] mt-3">
                  {(current.visibility / 1000).toFixed(1)} <span className="text-sm font-normal">km</span>
                </span>
                <span className="text-[11px] text-neutral-400 mt-1">
                  {current.visibility >= 10000 ? "Clear horizon" : "Hazy"}
                </span>
              </div>

              {/* Cloudiness Tile */}
              <div className="bg-[#F3F4F5] border border-black/[0.05] p-5 rounded-3xl flex flex-col justify-between">
                <span className="text-xs font-semibold text-neutral-500 uppercase">Clouds</span>
                <span className="text-3xl font-extrabold text-[#0A0B0D] mt-3">
                  {current.clouds}%
                </span>
                <span className="text-[11px] text-neutral-400 mt-1 capitalize">{current.description}</span>
              </div>
            </div>

            {/* 5-Day Extended Weather Outlook */}
            <div className="bg-[#F3F4F5] border border-black/[0.05] p-6 sm:p-8 rounded-3xl">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h4 className="text-lg font-bold text-[#0A0B0D]">5-Day Extended Outlook</h4>
                  <p className="text-xs text-neutral-500 mt-0.5">Forecast for {current.city}</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>Active Forecast</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {forecast.map((day, idx) => (
                  <div
                    key={`${day.dt}-${idx}`}
                    className="bg-white p-5 rounded-2xl border border-black/[0.04] shadow-sm flex flex-col justify-between items-center text-center gap-3 hover:shadow-md transition-all"
                  >
                    <div>
                      <span className="text-sm font-bold text-[#0A0B0D] block">
                        {day.dateText.split(",")[0]}
                      </span>
                      <span className="text-xs text-neutral-400">
                        {day.dateText.split(",")[1]?.trim()}
                      </span>
                    </div>

                    <div className="relative w-14 h-14 my-1">
                      <Image
                        src={`https://openweathermap.org/img/wn/${day.icon}@2x.png`}
                        alt={day.description}
                        fill
                        sizes="56px"
                        className="object-contain"
                        unoptimized
                      />
                    </div>

                    <div className="w-full">
                      <span className="text-xs font-semibold text-neutral-800 capitalize block truncate">
                        {day.description}
                      </span>
                      <div className="flex items-center justify-center gap-2 mt-1">
                        <span className="text-base font-bold text-[#0A0B0D]">
                          {day.temp_max}{tempUnit}
                        </span>
                        <span className="text-xs text-neutral-400 font-medium">
                          {day.temp_min}{tempUnit}
                        </span>
                      </div>
                    </div>

                    <div className="w-full pt-2 border-t border-black/[0.04] flex items-center justify-between text-[11px] text-neutral-500">
                      <span>💧 {day.humidity}%</span>
                      {day.pop > 0 && <span>🌧️ {Math.round(day.pop * 100)}%</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Minimalist Footer */}
      <footer className="border-t border-black/[0.06] py-6 text-center text-xs text-neutral-500 mt-12">
        <p>TimeSpot &bull; Next.js 16 App Router &bull; OpenWeather API Integration</p>
      </footer>
    </div>
  );
}
