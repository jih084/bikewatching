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

map.on('load', async () => {
  // Add Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#dd6d8a',  // Hex code color
      'line-width': 5,         // Thicker lines
      'line-opacity': 0.6      // Slightly less transparent
    }
  });

  // Add Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#6d8fdd',  // Hex code color
      'line-width': 5,         // Thicker lines
      'line-opacity': 0.6      // Slightly less transparent
    }
  });

  // Select the SVG element inside the map container
  const svg = d3.select('#map').select('svg');

  // Define the URL for Bluebikes station data
  const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
  const trafficDataUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

  try {
    // 1) Fetch and await the JSON data using D3
    const jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData);

    // 2) Access the stations array within the loaded JSON
    let stations = jsonData.data.stations;
    console.log('Stations Array:', stations);

    // 3) Load the CSV so we can compute arrivals/departures before creating circles
    const trips = await d3.csv(trafficDataUrl);
    console.log('Loaded Traffic Data:', trips);

    // 4) Calculate departures and arrivals
    const departures = d3.rollup(
      trips,
      (v) => v.length,
      (d) => d.start_station_id
    );
    const arrivals = d3.rollup(
      trips,
      (v) => v.length,
      (d) => d.end_station_id
    );

    // 5) Update each station with arrivals, departures, totalTraffic
    stations = stations.map(station => {
      let id = station.short_name;
      station.arrivals = arrivals.get(id) ?? 0;
      station.departures = departures.get(id) ?? 0;
      station.totalTraffic = station.arrivals + station.departures;
      return station;
    });

    console.log('Updated Stations with Traffic:', stations);
    console.log('Max Traffic:', d3.max(stations, d => d.totalTraffic));

    // 6) Create a radius scale AFTER we have totalTraffic
    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, d => d.totalTraffic)])
      .range([0, 25]);

    // 7) Append SVG circles for each station (now they have totalTraffic)
    const circles = svg.selectAll('circle')
      .data(stations)
      .enter()
      .append('circle')
      .attr('r', 5)               // Initial radius (will be overridden below)
      .attr('fill', 'steelblue')  // Fill color
      .attr('stroke', 'white')    // Border color
      .attr('stroke-width', 1)    // Border thickness
      .attr('opacity', 0.8)       // Circle opacity
      .each(function(d) {
        // Add <title> for browser tooltips
        d3.select(this)
          .append('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });

    // 8) Function to update circle positions when the map moves/zooms
    function updatePositions() {
      circles
        .attr('cx', d => getCoords(d).cx) // Set x-position using projected coordinates
        .attr('cy', d => getCoords(d).cy); // Set y-position using projected coordinates
    }

    // 9) Now adjust the circle radii based on totalTraffic
    circles.attr('r', (d) => radiusScale(d.totalTraffic));

    // 10) Initial position update when map loads
    updatePositions();

    // 11) Reposition markers on map interactions
    map.on('move', updatePositions);   // Update during panning
    map.on('zoom', updatePositions);   // Update during zooming
    map.on('resize', updatePositions); // Update on window resize
    map.on('moveend', updatePositions);// Final update after movement ends

  } catch (error) {
    console.error('Error loading JSON:', error);
  }
});
