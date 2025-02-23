// Import Mapbox as an ES module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log("Mapbox GL JS Loaded:", mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1Ijoiem9leXloZSIsImEiOiJjbTdoN253MTgwMmlwMmxwemphMG1hOWJvIn0.uTfcIv7WIb2Xyf6YmBkngQ';


// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18 // Maximum allowed zoom
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point); // Project to pixel coordinates
  return { cx: x, cy: y }; // Return as object for use in SVG attributes
}


// 1) Compute station arrivals/departures/traffic
function computeStationTraffic(stations, trips) {
  // Compute departures
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id
  );
  // Compute arrivals
  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  // Update each station with arrivals, departures, totalTraffic
  return stations.map((station) => {
    let id = station.short_name; // Make sure it matches CSV's station ID
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// 2) Helper: Convert Date object to minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// 3) Filter trips based on ±60 minutes around timeFilter
function filterTripsByTime(trips, timeFilter) {
  if (timeFilter === -1) {
    // No filter applied
    return trips;
  }
  return trips.filter((trip) => {
    const startedMinutes = minutesSinceMidnight(trip.started_at);
    const endedMinutes = minutesSinceMidnight(trip.ended_at);

    // Keep trips that start OR end within 60 min of timeFilter
    return (
      Math.abs(startedMinutes - timeFilter) <= 60 ||
      Math.abs(endedMinutes - timeFilter) <= 60
    );
  });
}

let timeFilter = -1;

let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

map.on('load', async () => {
  // === Add Boston Bike Lanes ===
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#dd6d8a',
      'line-width': 5,
      'line-opacity': 0.6
    }
  });

  // === Add Cambridge Bike Lanes ===
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#6d8fdd',
      'line-width': 5,
      'line-opacity': 0.6
    }
  });

  // Select the SVG element inside the map container
  const svg = d3.select('#map').select('svg');

  // Define the URLs for data
  const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
  const trafficDataUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

  try {
    // === Load Station JSON ===
    const jsonData = await d3.json(jsonurl);
    let stations = jsonData.data.stations;
    console.log('Loaded JSON Data:', jsonData);
    console.log('Stations Array:', stations);

    // === Load CSV with date parsing (Step 5.3) ===
    const trips = await d3.csv(trafficDataUrl, (row) => {
      row.started_at = new Date(row.started_at);
      row.ended_at = new Date(row.ended_at);
      return row;
    });
    console.log('Loaded Traffic Data:', trips);

    // === Compute Station Traffic (No Filter) ===
    stations = computeStationTraffic(stations, trips);
    console.log('Updated Stations with Traffic:', stations);

    // Define a sqrt scale for circle radii
    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range([0, 25]);

    // === Create Circles with a Key Function ===
    const circles = svg.selectAll('circle')
    .data(stations, (d) => d.short_name) // KEY function
    .enter()
    .append('circle')
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8)
    // Step 6.1: set a CSS variable for color mixing
    .style('--departure-ratio', (d) => {
      // Avoid dividing by zero if totalTraffic=0
      return d.totalTraffic > 0
        ? stationFlow(d.departures / d.totalTraffic)
        : 0.5; // If no traffic, set ratio to 0.5 or any default
    })
    .each(function(d) {
      // Basic tooltip
      d3.select(this)
        .append('title')
        .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    });
  

    // Position circles according to the map
    function updatePositions() {
      circles
        .attr('cx', (d) => getCoords(d).cx)
        .attr('cy', (d) => getCoords(d).cy);
    }
    updatePositions();

    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    // === Step 5.3: Define updateScatterPlot() to Filter & Update Circles ===
    function updateScatterPlot(timeFilter) {
      // 1) Filter trips by time
      const filteredTrips = filterTripsByTime(trips, timeFilter);

      // 2) Recompute station traffic with the filtered trips
      const filteredStations = computeStationTraffic(stations, filteredTrips);

      // 3) Dynamically adjust the circle size range
      if (timeFilter === -1) {
        radiusScale.range([0, 25]);
      } else {
        radiusScale.range([3, 50]);
      }

      // 4) Rebind data using a key, then update circle sizes
      circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) => {
        // Same logic to avoid dividing by zero
        return d.totalTraffic > 0
          ? stationFlow(d.departures / d.totalTraffic)
          : 0.5;
      });
    
    }

    // === Time Slider & Display Logic (from Step 5.2) ===
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    function updateTimeDisplay() {
      timeFilter = Number(timeSlider.value);
      if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'block';
      } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
      }

      // 5) Call updateScatterPlot to reflect changes
      updateScatterPlot(timeFilter);
    }

    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay(); // Initialize once

  } catch (error) {
    console.error('Error loading JSON:', error);
  }
});

// Formats a number of minutes since midnight into "HH:MM AM/PM"
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}