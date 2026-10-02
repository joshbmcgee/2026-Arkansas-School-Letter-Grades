(function () {
  "use strict";

  const GRADE_ORDER = ["A", "B", "C", "D", "F"];
  const GRADE_COLORS = {
    A: "#1f77b4",
    B: "#2ca02c",
    C: "#a2a40f",
    D: "#e66d00",
    F: "#c92228"
  };
  const ALL = "All";
  const SHARED_LOCATION_OFFSET_PX = {
    2: 7,
    3: 8,
    4: 9
  };

  const controls = {
    search: document.getElementById("school-search"),
    gradeOptions: document.getElementById("grade-options"),
    gradeSpan: document.getElementById("grade-span"),
    cooperative: document.getElementById("cooperative"),
    povertyMin: document.getElementById("poverty-min"),
    povertyMax: document.getElementById("poverty-max"),
    povertyRange: document.getElementById("poverty-range"),
    povertyMinValue: document.getElementById("poverty-min-value"),
    povertyMaxValue: document.getElementById("poverty-max-value"),
    districtBoundaries: document.getElementById("district-boundaries"),
    reset: document.getElementById("reset-filters"),
    error: document.getElementById("load-error")
  };

  let schools = [];
  let map;
  let markerLayer;
  let stateLayer;
  let districtLayer;
  let initialBounds;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function displayValue(value, fallback = "Not available") {
    return value === null || value === undefined || value === "" ? fallback : String(value);
  }

  function formatNumber(value) {
    return Number.isFinite(Number(value))
      ? Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })
      : "Not available";
  }

  function formatPoverty(value) {
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : "Not available";
  }

  function coordinateKey(school) {
    return `${school.latitude.toFixed(6)},${school.longitude.toFixed(6)}`;
  }

  function normalizeFeature(feature) {
    const properties = feature.properties || {};
    const coordinates = feature.geometry?.coordinates || [];
    return {
      ...properties,
      school_lea: String(properties.school_lea),
      latitude: Number(coordinates[1]),
      longitude: Number(coordinates[0]),
      poverty_rate: Number(properties.poverty_rate),
      enrollment: Number(properties.enrollment)
    };
  }

  function initializeMap() {
    map = L.map("map", {
      minZoom: 6,
      maxZoom: 18,
      zoomControl: true,
      preferCanvas: true
    });

    const statePane = map.createPane("state-boundary-pane");
    statePane.style.zIndex = "360";
    statePane.style.pointerEvents = "none";

    const districtPane = map.createPane("district-boundary-pane");
    districtPane.style.zIndex = "380";
    districtPane.style.pointerEvents = "none";

    L.tileLayer("https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri &mdash; Sources: Esri, TomTom, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors, and the GIS User Community"
    }).addTo(map);

    markerLayer = L.layerGroup().addTo(map);

    if (window.ARKANSAS_BORDER) {
      stateLayer = L.geoJSON(window.ARKANSAS_BORDER, {
        interactive: false,
        pane: "state-boundary-pane",
        style: {
          color: "#123b2a",
          weight: 3,
          opacity: 0.92,
          fillColor: "#dce8df",
          fillOpacity: 0.16
        }
      }).addTo(map);
      initialBounds = stateLayer.getBounds().pad(0.03);
      map.fitBounds(initialBounds);
    } else {
      map.setView([34.8, -92.2], 7);
    }

    if (!window.SCHOOL_DISTRICTS) {
      controls.districtBoundaries.disabled = true;
    }
  }

  function buildGradeControls() {
    controls.gradeOptions.replaceChildren();

    GRADE_ORDER.forEach((grade) => {
      const safeId = grade.replace(/[^a-z0-9]/gi, "-").toLowerCase();
      const wrapper = document.createElement("div");
      wrapper.className = "grade-choice";
      wrapper.style.setProperty("--grade-color", GRADE_COLORS[grade]);

      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "grade";
      input.value = grade;
      input.id = `grade-${safeId}`;
      input.checked = true;

      const label = document.createElement("label");
      label.htmlFor = input.id;
      label.textContent = grade;

      wrapper.append(input, label);
      controls.gradeOptions.append(wrapper);
    });
  }

  function populateSelect(select, values, allLabel) {
    select.replaceChildren();
    const allOption = document.createElement("option");
    allOption.value = ALL;
    allOption.textContent = allLabel;
    select.append(allOption);

    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    });
  }

  function initializeControls() {
    buildGradeControls();
    const collator = new Intl.Collator("en-US");
    const gradeSpans = [...new Set(schools.map((school) => school.grade_span))].sort(collator.compare);
    const cooperatives = [...new Set(schools.map((school) => school.cooperative))].sort(collator.compare);

    populateSelect(controls.gradeSpan, gradeSpans, "All grade spans");
    populateSelect(controls.cooperative, cooperatives, "All cooperatives");

    controls.search.addEventListener("input", applyFilters);
    controls.gradeOptions.addEventListener("change", applyFilters);
    controls.gradeSpan.addEventListener("change", applyFilters);
    controls.cooperative.addEventListener("change", applyFilters);
    controls.povertyMin.addEventListener("input", () => handlePovertyChange("min"));
    controls.povertyMax.addEventListener("input", () => handlePovertyChange("max"));
    controls.districtBoundaries.addEventListener("change", updateDistrictBoundaries);
    controls.reset.addEventListener("click", resetFilters);
  }

  function updateDistrictBoundaries() {
    if (!window.SCHOOL_DISTRICTS) {
      controls.districtBoundaries.checked = false;
      return;
    }

    if (controls.districtBoundaries.checked) {
      if (!districtLayer) {
        districtLayer = L.geoJSON(window.SCHOOL_DISTRICTS, {
          interactive: false,
          pane: "district-boundary-pane",
          style: {
            color: "#52645b",
            weight: 1,
            opacity: 0.72,
            fill: false,
            fillOpacity: 0
          }
        });
      }
      map.addLayer(districtLayer);
    } else if (districtLayer) {
      map.removeLayer(districtLayer);
    }
  }

  function selectedGrades() {
    return new Set(
      [...document.querySelectorAll('input[name="grade"]:checked')].map((input) => input.value)
    );
  }

  function handlePovertyChange(changedControl) {
    let min = Number(controls.povertyMin.value);
    let max = Number(controls.povertyMax.value);

    if (min > max) {
      if (changedControl === "min") {
        max = min;
        controls.povertyMax.value = String(max);
      } else {
        min = max;
        controls.povertyMin.value = String(min);
      }
    }

    updatePovertyDisplay(min, max);
    applyFilters();
  }

  function updatePovertyDisplay(min, max) {
    controls.povertyMinValue.textContent = `${min}%`;
    controls.povertyMaxValue.textContent = `${max}%`;
    controls.povertyRange.style.setProperty("--range-start", `${min}%`);
    controls.povertyRange.style.setProperty("--range-end", `${max}%`);
  }

  function resetFilters() {
    controls.search.value = "";
    document.querySelectorAll('input[name="grade"]').forEach((input) => {
      input.checked = true;
    });
    controls.gradeSpan.value = ALL;
    controls.cooperative.value = ALL;
    controls.povertyMin.value = "0";
    controls.povertyMax.value = "100";
    updatePovertyDisplay(0, 100);
    controls.districtBoundaries.checked = false;
    updateDistrictBoundaries();
    applyFilters();
    if (initialBounds) {
      map.fitBounds(initialBounds);
    }
  }

  function getFilteredSchools() {
    const grades = selectedGrades();
    const query = controls.search.value.trim().toLocaleLowerCase("en-US");
    const gradeSpan = controls.gradeSpan.value;
    const cooperative = controls.cooperative.value;
    const povertyMin = Number(controls.povertyMin.value);
    const povertyMax = Number(controls.povertyMax.value);

    return schools.filter((school) => {
      const matchesQuery = !query ||
        school.school_name.toLocaleLowerCase("en-US").includes(query) ||
        school.district_name.toLocaleLowerCase("en-US").includes(query);

      return grades.has(school.grade_2026) &&
        (gradeSpan === ALL || school.grade_span === gradeSpan) &&
        (cooperative === ALL || school.cooperative === cooperative) &&
        school.poverty_rate >= povertyMin &&
        school.poverty_rate <= povertyMax &&
        matchesQuery;
    });
  }

  function groupByCoordinates(filteredSchools) {
    const groups = new Map();
    filteredSchools.forEach((school) => {
      const key = coordinateKey(school);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(school);
    });
    return groups;
  }

  function schoolPopup(school) {
    return `
      <article class="school-popup">
        <h3 class="popup-school-name">${escapeHtml(school.school_name)}</h3>
        <dl>
          <div class="popup-row"><dt>District</dt><dd>${escapeHtml(displayValue(school.district_name))}</dd></div>
          <div class="popup-row"><dt>2026 grade</dt><dd>${escapeHtml(displayValue(school.grade_2026))}</dd></div>
          <div class="popup-row"><dt>Grade span</dt><dd>${escapeHtml(displayValue(school.grade_span))} (${escapeHtml(displayValue(school.grade_range))})</dd></div>
          <div class="popup-row"><dt>2025 grade</dt><dd>${escapeHtml(displayValue(school.grade_2025))}</dd></div>
          <div class="popup-row"><dt>Enrollment</dt><dd>${escapeHtml(formatNumber(school.enrollment))}</dd></div>
          <div class="popup-row"><dt>FRL</dt><dd>${escapeHtml(formatPoverty(school.poverty_rate))}</dd></div>
        </dl>
      </article>`;
  }

  function markerLatLng(school, index, groupSize) {
    const originalLatLng = [school.latitude, school.longitude];
    if (groupSize === 1) {
      return originalLatLng;
    }

    const radius = SHARED_LOCATION_OFFSET_PX[groupSize] || 10;
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / groupSize;
    const point = map.latLngToLayerPoint(originalLatLng);

    return map.layerPointToLatLng({
      x: point.x + Math.cos(angle) * radius,
      y: point.y + Math.sin(angle) * radius
    });
  }

  function addMarkers(groups) {
    markerLayer.clearLayers();

    groups.forEach((group) => {
      const sortedGroup = [...group].sort((a, b) =>
        a.school_name.localeCompare(b.school_name) || a.school_lea.localeCompare(b.school_lea)
      );

      sortedGroup.forEach((school, index) => {
        const marker = L.circleMarker(markerLatLng(school, index, sortedGroup.length), {
          radius: 6,
          color: "#3f4b46",
          weight: 1,
          opacity: 1,
          fillColor: GRADE_COLORS[school.grade_2026],
          fillOpacity: 0.9
        });
        marker.bindTooltip(
          `${escapeHtml(school.school_name)}<br>2026 grade: ${escapeHtml(school.grade_2026)}`,
          { direction: "auto", opacity: 0.96 }
        );
        marker.bindPopup(schoolPopup(school), {
          maxWidth: 380,
          maxHeight: 470,
          autoPanPadding: [30, 30]
        });
        marker.addTo(markerLayer);
      });
    });
  }

  function applyFilters() {
    const filtered = getFilteredSchools();
    const groups = groupByCoordinates(filtered);

    addMarkers(groups);
  }

  function showError(message) {
    controls.error.hidden = false;
    controls.error.textContent = message;
  }

  function validateData(featureCollection) {
    if (!featureCollection || featureCollection.type !== "FeatureCollection") {
      throw new Error("The generated school data are not a GeoJSON FeatureCollection.");
    }
    if (!Array.isArray(featureCollection.features) || featureCollection.features.length === 0) {
      throw new Error("The generated school data contain no schools.");
    }

    const ids = new Set();
    featureCollection.features.forEach((feature) => {
      const id = String(feature.id);
      const coordinates = feature.geometry?.coordinates;
      if (ids.has(id)) {
        throw new Error(`Duplicate School LEA in generated data: ${id}`);
      }
      if (!Array.isArray(coordinates) || coordinates.length !== 2 || coordinates.some((value) => !Number.isFinite(Number(value)))) {
        throw new Error(`Invalid map coordinates for School LEA ${id}.`);
      }
      if (!GRADE_ORDER.includes(feature.properties?.grade_2026)) {
        throw new Error(`Unsupported 2026 letter grade for School LEA ${id}.`);
      }
      ids.add(id);
    });
  }

  function start() {
    try {
      if (typeof L === "undefined") {
        throw new Error("Leaflet did not load. Check the internet connection or vendor Leaflet locally.");
      }
      validateData(window.SCHOOL_DATA);
      schools = window.SCHOOL_DATA.features.map(normalizeFeature);
      initializeMap();
      initializeControls();
      map.on("zoomend", applyFilters);
      applyFilters();
    } catch (error) {
      console.error(error);
      showError(error.message || "The map could not be initialized.");
    }
  }

  start();
})();
