<template>
  <div class="clusters-map-container">
    <div v-if="isLoading" class="loading">
      {{ $t('app.loading') }}
    </div>
    <div v-show="!isLoading" ref="mapContainer" class="clusters-map"></div>
    <div v-if="isDrawingMode" class="polygon-edit-controls">
      <AppButton variant="primary" @click="savePolygon">{{ $t('common.save') }}</AppButton>
      <AppButton variant="secondary" @click="cancelPolygon">{{ $t('common.cancel') }}</AppButton>
    </div>
  </div>
</template>

<script setup>
  /* global maplibregl, MapboxDraw */
  import {
    ref,
    onMounted,
    onBeforeUnmount,
    watch,
    computed,
    provide,
    onBeforeMount,
    nextTick,
  } from 'vue'
  import { inject } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useAuth } from '../composables/useAuth.js'
  import { useClusters } from '../composables/useClusters.js'
  import { useUrlFilters } from '../composables/useUrlFilters.js'
  import { addNotification } from '../composables/useNotifications.js'
  import AppButton from './ui/AppButton.vue'

  let mapLibreLoaded = false
  let mapLibreDrawLoaded = false

  const loadMapLibre = async () => {
    if (mapLibreLoaded && window.maplibregl) return window.maplibregl
    return new Promise((resolve, reject) => {
      if (window.maplibregl) {
        mapLibreLoaded = true
        resolve(window.maplibregl)
        return
      }
      const script = document.createElement('script')
      script.src = 'https://unpkg.com/maplibre-gl@2.4.0/dist/maplibre-gl.js'
      script.onload = () => {
        mapLibreLoaded = true
        resolve(window.maplibregl)
      }
      script.onerror = () => reject(new Error(t('map.error.loadMapLibre')))
      document.head.appendChild(script)

      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/maplibre-gl@2.4.0/dist/maplibre-gl.css'
      document.head.appendChild(link)
    })
  }

  const loadMapLibreDraw = async () => {
    if (mapLibreDrawLoaded && window.MapboxDraw) return window.MapboxDraw
    return new Promise((resolve, reject) => {
      if (window.MapboxDraw) {
        mapLibreDrawLoaded = true
        resolve(window.MapboxDraw)
        return
      }
      const script = document.createElement('script')
      script.src = 'https://unpkg.com/@mapbox/mapbox-gl-draw@1.4.0/dist/mapbox-gl-draw.js'
      script.onload = () => {
        mapLibreDrawLoaded = true
        resolve(window.MapboxDraw)
      }
      script.onerror = () => reject(new Error(t('map.error.loadMapLibreDraw')))
      document.head.appendChild(script)

      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/@mapbox/mapbox-gl-draw@1.4.0/dist/mapbox-gl-draw.css'
      document.head.appendChild(link)
    })
  }

  const { t } = useI18n()

  const emit = defineEmits(['polygon-saved'])

  const props = defineProps({
    location: {
      type: Object,
      default: null,
    },
  })

  const isSimpleMode = computed(() => !!props.location)

  const authState = useAuth()
  const { token, user } = authState

  let skipFitMapOnClusterClick = false
  const skipFitMapOnExternalUrlChange = ref(false)
  let externalUrlResetTimer = null

  const markExternalUrlChange = () => {
    skipFitMapOnExternalUrlChange.value = true
    if (externalUrlResetTimer) clearTimeout(externalUrlResetTimer)
    externalUrlResetTimer = setTimeout(() => {
      skipFitMapOnExternalUrlChange.value = false
      externalUrlResetTimer = null
    }, 400)
  }

  const urlFilters = useUrlFilters()
  const clustersState = useClusters(token)

  const clusters = computed(() => clustersState.clusters.value)
  const currentClusterId = computed(() => clustersState.currentClusterId.value)

  const selectedClusterIds = computed(() => urlFilters.filters.clusters || [])
  const selectedPlaces = computed(() => urlFilters.filters.places || [])
  const selectedParticipants = computed(() => urlFilters.filters.participants || [])

  const filterContext = inject('filterContext', null)
  const eventsPlaces = computed(() => filterContext?.places?.value || [])
  const hoveredPlace = computed(() => filterContext?.hoveredPlace?.value || null)

  const themeContext = inject('themeContext', null)
  const currentTheme = computed(() => themeContext?.actualTheme?.value || 'light')

  const clearHoveredHighlight = () => {
    if (mapInstance) {
      if (mapInstance.getSource('hover-highlight')) {
        mapInstance.removeLayer('hover-highlight')
        mapInstance.removeSource('hover-highlight')
      }
    }
  }

  const normalizePolygon = (polygon) => {
    if (!polygon) return null
    let geometry
    try {
      geometry = typeof polygon === 'object' && polygon.type ? polygon : JSON.parse(polygon)
    } catch (e) {
      console.warn('Failed to parse polygon', e)
      return null
    }
    if (!geometry) return null
    if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
      return geometry
    }
    if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
      return geometry
    }
    if (Array.isArray(geometry)) {
      const coords = geometry
        .map((p) => (Array.isArray(p) && p.length >= 2 ? [Number(p[1]), Number(p[0])] : null))
        .filter(Boolean)
      if (coords.length >= 3) {
        return { type: 'Polygon', coordinates: [coords] }
      }
    }
    return null
  }

  const showHoveredHighlight = (place) => {
    if (!mapInstance) return
    clearHoveredHighlight()
    if (!place) return

    if (place.polygon) {
      const geometry = normalizePolygon(place.polygon)
      if (geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')) {
        mapInstance.addSource('hover-highlight', { type: 'geojson', data: geometry })
        mapInstance.addLayer({
          id: 'hover-highlight',
          type: 'fill',
          source: 'hover-highlight',
          paint: {
            'fill-color': MAP_VISUALS().hover.fillColor,
            'fill-opacity': MAP_VISUALS().hover.fillOpacity,
            'fill-outline-color': MAP_VISUALS().hover.outlineColor,
          },
        })
        return
      }
    }

    if (place.latitude != null && place.longitude != null) {
      const radius = typeof place.radius === 'number' && !isNaN(place.radius) ? place.radius : 100
      const centerLng = place.longitude
      const centerLat = place.latitude
      const steps = 32
      const circleCoords = []
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * 2 * Math.PI
        const lng =
          centerLng + (radius / (111320 * Math.cos((centerLat * Math.PI) / 180))) * Math.cos(angle)
        const lat2 = centerLat + (radius / 111320) * Math.sin(angle)
        circleCoords.push([lng, lat2])
      }
      const geojson = {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [circleCoords],
        },
      }
      mapInstance.addSource('hover-highlight', { type: 'geojson', data: geojson })
      mapInstance.addLayer({
        id: 'hover-highlight',
        type: 'fill',
        source: 'hover-highlight',
        paint: {
          'fill-color': MAP_VISUALS().hover.fillColor,
          'fill-opacity': MAP_VISUALS().hover.fillOpacity,
          'fill-outline-color': MAP_VISUALS().hover.outlineColor,
        },
      })
    }
  }

  watch(hoveredPlace, (newPlace) => {
    showHoveredHighlight(newPlace)
  })

  const isClusterSelected = (cluster) => {
    if (selectedClusterIds.value.map(String).includes(String(cluster.id))) return true
    return (cluster.placeIds || []).some((pid) => {
      const place = eventsPlaces.value?.find((p) => p.id === pid)
      return place && selectedPlaces.value.includes(place.name)
    })
  }

  const isClusterHighlighted = (cluster) => {
    if (isClusterSelected(cluster)) return true
    if (selectedParticipants.value.length > 0 && cluster.hasParticipantMedia === true) return true
    return false
  }

  const cssVar = (name, fallback) =>
    getComputedStyle(document.body).getPropertyValue(name).trim() || fallback

  const formatCount = (n) => {
    const num = Number(n) || 0
    if (num >= 1000000) return `${Math.floor(num / 1000000)}M+`
    if (num >= 1000) return `${Math.floor(num / 1000)}K+`
    return String(num)
  }

  const MAP_VISUALS = () => ({
    cluster: {
      marker: {
        size: 16,
        borderWidth: 1,
        borderColor: cssVar('--map-cluster-marker-border', '#ffffff'),
        borderRadius: '50%',
        fontSize: '8px',
        textColor: cssVar('--primary', '#ffffff'),
        defaultColor: cssVar('--map-cluster-default', '#2196F3'),
        selectedColor: cssVar('--map-cluster-selected', '#4CAF50'),
        defaultOpacity: 0.3,
        selectedOpacity: 1.0,
        maxOpacity: 1.0,
        opacityFactor: 0.03,
        defaultOpacityMultiplier: 0.3,
      },
      rectangle: {
        defaultColor: cssVar('--map-cluster-default', '#2196F3'),
        selectedColor: cssVar('--map-cluster-selected', '#4CAF50'),
        maxOpacity: 0.3,
        opacityFactor: 0.03,
        defaultOpacityMultiplier: 0.3,
        strokeWidth: 1,
      },
    },
    polygon: {
      default: {
        fillColor: cssVar('--map-polygon-default-fill', '#FF9800'),
        fillOpacity: 0,
        outlineColor: cssVar('--map-polygon-default-outline', '#FF9800'),
      },
      selected: {
        fillColor: cssVar('--map-polygon-selected-fill', '#FFA000'),
        fillOpacity: 0.1,
        outlineColor: cssVar('--map-polygon-selected-outline', '#FF9800'),
      },
    },
    hover: {
      fillColor: cssVar('--map-hover-fill', '#FF0000'),
      fillOpacity: 0.1,
      outlineColor: cssVar('--map-hover-outline', '#FF0000'),
    },
    heatmap: {
      colors: [
        cssVar('--map-heat-0', 'rgba(33,102,172,0)'),
        cssVar('--map-heat-02', 'rgb(103,169,207)'),
        cssVar('--map-heat-04', 'rgb(209,229,240)'),
        cssVar('--map-heat-06', 'rgb(253,219,199)'),
        cssVar('--map-heat-08', 'rgb(239,138,98)'),
        cssVar('--map-heat-1', 'rgb(178,24,43)'),
      ],
    },
  })

  const MAP_ZOOM = {
    heatmap: {
      max: 18,
      radius: { zoom0: 2, zoom9: 50 },
      opacity: { zoom7: 1, zoom9: 0.3 },
      intensity: { zoom0: 1, zoom9: 3 },
    },
    cluster: {
      markerVisibleMin: 10,
      rectangleMin: 14,
    },
    fitBounds: {
      clusters: 15,
      polygon: 12,
    },
  }

  const getRectangleOpacity = (mediaCount, isSelected) => {
    const { maxOpacity, opacityFactor, defaultOpacityMultiplier } = MAP_VISUALS().cluster.rectangle
    const base = Math.min(mediaCount * opacityFactor, maxOpacity)
    return isSelected ? base : base * defaultOpacityMultiplier
  }

  const isLoading = ref(true)
  const isDrawingMode = ref(false)
  let drawControl = null
  const currentPlaceIdForPolygon = ref(null)
  let simpleMarker = null

  const mapContainer = ref(null)

  let resizeObserver = null

  const setupResizeObserver = () => {
    if (resizeObserver) return
    const container = mapContainer.value
    if (!container) return

    resizeObserver = new ResizeObserver((entries) => {
      if (!mapInstance) return
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          mapInstance.resize()
        }
      }
    })
    resizeObserver.observe(container)
  }

  const teardownResizeObserver = () => {
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
  }

  const setupVisibilityObserver = () => {
    if (visibilityObserver) return
    const container = mapContainer.value
    if (!container || !window.IntersectionObserver) return

    visibilityObserver = new IntersectionObserver(
      (entries) => {
        isMapVisible.value = entries[0]?.isIntersecting ?? false
      },
      { threshold: 0.1 },
    )
    visibilityObserver.observe(container)
  }

  const teardownVisibilityObserver = () => {
    if (visibilityObserver) {
      visibilityObserver.disconnect()
      visibilityObserver = null
    }
  }

  let zoomHandler = null
  let rafId = null
  let visibilityObserver = null
  const isMapVisible = ref(false)

  let mapInstance = null

  const addSimpleMarker = () => {
    if (!mapInstance || !props.location) return
    const { lat, lng } = props.location
    if (lat == null || lng == null) return

    if (simpleMarker) {
      simpleMarker.remove()
    }

    mapInstance.setCenter([lng, lat])
    mapInstance.setZoom(MAP_ZOOM.fitBounds.polygon)

    const el = document.createElement('div')
    el.style.cssText =
      'width:24px;height:24px;background:#e74c3c;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;'

    simpleMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(mapInstance)
  }

  const addCustomMapLayers = () => {
    if (!mapInstance) return
    if (isSimpleMode.value) return

    mapInstance.addSource('places-polygons', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    mapInstance.addLayer({
      id: 'places-polygons-fill',
      type: 'fill',
      source: 'places-polygons',
      paint: {
        'fill-color': [
          'case',
          ['==', ['get', 'selected'], true],
          MAP_VISUALS().polygon.selected.fillColor,
          MAP_VISUALS().polygon.default.fillColor,
        ],
        'fill-opacity': [
          'case',
          ['==', ['get', 'selected'], true],
          MAP_VISUALS().polygon.selected.fillOpacity,
          MAP_VISUALS().polygon.default.fillOpacity,
        ],
        'fill-outline-color': MAP_VISUALS().polygon.default.outlineColor,
      },
    })
    mapInstance.addLayer({
      id: 'places-polygons-outline',
      type: 'line',
      source: 'places-polygons',
      paint: {
        'line-color': MAP_VISUALS().polygon.default.outlineColor,
        'line-width': 1,
        'line-opacity': 0.5,
      },
    })
    updatePlacesPolygons()

    mapInstance.addSource('clusters-heatmap-raw', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    mapInstance.addLayer({
      id: 'clusters-heatmap',
      type: 'heatmap',
      source: 'clusters-heatmap-raw',
      maxzoom: MAP_ZOOM.heatmap.max,
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'count'], 0, 0, 50, 0.5, 100, 1],
        'heatmap-intensity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0,
          MAP_ZOOM.heatmap.intensity.zoom0,
          9,
          MAP_ZOOM.heatmap.intensity.zoom9,
        ],
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          MAP_VISUALS().heatmap.colors[0],
          0.2,
          MAP_VISUALS().heatmap.colors[1],
          0.4,
          MAP_VISUALS().heatmap.colors[2],
          0.6,
          MAP_VISUALS().heatmap.colors[3],
          0.8,
          MAP_VISUALS().heatmap.colors[4],
          1,
          MAP_VISUALS().heatmap.colors[5],
        ],
        'heatmap-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          0,
          MAP_ZOOM.heatmap.radius.zoom0,
          9,
          MAP_ZOOM.heatmap.radius.zoom9,
        ],
        'heatmap-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          7,
          MAP_ZOOM.heatmap.opacity.zoom7,
          9,
          MAP_ZOOM.heatmap.opacity.zoom9,
        ],
      },
    })

    mapInstance.addSource('clusters-geojson', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 13,
      clusterRadius: 30,
      clusterProperties: {
        sumCount: ['+', ['get', 'count']],
        sumMedia: ['+', ['get', 'mediaCount']],
      },
    })

    mapInstance.addLayer({
      id: 'clusters-circle',
      type: 'circle',
      source: 'clusters-geojson',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'interpolate',
          ['linear'],
          ['get', 'sumMedia'],
          0,
          cssVar('--map-cluster-low', '#2166AC'),
          10,
          cssVar('--map-cluster-mid', '#67A9CF'),
          50,
          cssVar('--map-cluster-high', '#EF8A62'),
          100,
          cssVar('--map-cluster-max', '#B2182B'),
        ],
        'circle-radius': ['step', ['get', 'sumMedia'], 20, 10, 30, 50, 40],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 13, 0.2],
      },
    })
    mapInstance.addLayer({
      id: 'clusters-count',
      type: 'symbol',
      source: 'clusters-geojson',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': [
          'concat',
          [
            'case',
            ['>=', ['get', 'sumMedia'], 1000000],
            [
              'concat',
              ['to-string', ['floor', ['/', ['get', 'sumMedia'], 1000000]]],
              '.',
              [
                'to-string',
                [
                  'floor',
                  [
                    '/',
                    [
                      '-',
                      ['get', 'sumMedia'],
                      ['*', ['floor', ['/', ['get', 'sumMedia'], 1000000]], 1000000],
                    ],
                    100000,
                  ],
                ],
              ],
            ],
            ['>=', ['get', 'sumMedia'], 1000],
            [
              'concat',
              ['to-string', ['floor', ['/', ['get', 'sumMedia'], 1000]]],
              '.',
              [
                'to-string',
                [
                  'floor',
                  [
                    '/',
                    [
                      '-',
                      ['get', 'sumMedia'],
                      ['*', ['floor', ['/', ['get', 'sumMedia'], 1000]], 1000],
                    ],
                    100,
                  ],
                ],
              ],
            ],
            ['to-string', ['get', 'sumMedia']],
          ],
          [
            'case',
            ['>=', ['get', 'sumMedia'], 1000000],
            'M+',
            ['>=', ['get', 'sumMedia'], 1000],
            'K+',
            '',
          ],
        ],
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
        'text-size': 12,
      },
      paint: {
        'text-color': MAP_VISUALS().cluster.marker.textColor,
      },
    })
    mapInstance.addLayer({
      id: 'clusters-unclustered',
      type: 'circle',
      source: 'clusters-geojson',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': [
          'interpolate',
          ['linear'],
          ['get', 'mediaCount'],
          0,
          cssVar('--map-cluster-low', '#2166AC'),
          10,
          cssVar('--map-cluster-mid', '#67A9CF'),
          50,
          cssVar('--map-cluster-high', '#EF8A62'),
          100,
          cssVar('--map-cluster-max', '#B2182B'),
        ],
        'circle-radius': 6,
        'circle-opacity': ['get', 'pointOpacity'],
        'circle-stroke-width': 1,
        'circle-stroke-color': '#ffffff',
      },
    })
    mapInstance.addLayer({
      id: 'clusters-unclustered-count',
      type: 'symbol',
      source: 'clusters-geojson',
      filter: ['!', ['has', 'point_count']],
      layout: {
        'text-field': ['get', 'countLabel'],
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
        'text-size': 10,
      },
      paint: {
        'text-color': MAP_VISUALS().cluster.marker.textColor,
      },
    })

    mapInstance.addSource('clusters-rectangles', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    mapInstance.addLayer({
      id: 'clusters-rectangles-fill',
      type: 'fill',
      source: 'clusters-rectangles',
      paint: {
        'fill-color': [
          'case',
          ['==', ['get', 'selected'], true],
          MAP_VISUALS().cluster.rectangle.selectedColor,
          [
            'interpolate',
            ['linear'],
            ['get', 'mediaCount'],
            0,
            cssVar('--map-cluster-low', '#2166AC'),
            10,
            cssVar('--map-cluster-mid', '#67A9CF'),
            50,
            cssVar('--map-cluster-high', '#EF8A62'),
            100,
            cssVar('--map-cluster-max', '#B2182B'),
          ],
        ],
        'fill-opacity': ['get', 'fillOpacity'],
      },
    })
    mapInstance.addLayer({
      id: 'clusters-rectangles-stroke',
      type: 'line',
      source: 'clusters-rectangles',
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'selected'], true],
          MAP_VISUALS().cluster.rectangle.selectedColor,
          [
            'interpolate',
            ['linear'],
            ['get', 'mediaCount'],
            0,
            cssVar('--map-cluster-low', '#2166AC'),
            10,
            cssVar('--map-cluster-mid', '#67A9CF'),
            50,
            cssVar('--map-cluster-high', '#EF8A62'),
            100,
            cssVar('--map-cluster-max', '#B2182B'),
          ],
        ],
        'line-width': MAP_VISUALS().cluster.rectangle.strokeWidth,
        'line-opacity': 0.5,
      },
    })

    mapInstance.on('click', 'clusters-rectangles-fill', (e) => {
      if (isDrawingMode.value) return
      const features = mapInstance.queryRenderedFeatures(e.point, {
        layers: ['clusters-rectangles-fill'],
      })
      if (features.length > 0) {
        const clusterId = features[0].properties.clusterId
        const currentlySelected = isClusterSelected({ id: clusterId })
        skipFitMapOnClusterClick = true
        urlFilters.toggleFilter('clusters', clusterId, !currentlySelected)
      }
    })

    mapInstance.on('mouseenter', 'clusters-rectangles-fill', () => {
      mapInstance.getCanvas().style.cursor = 'pointer'
    })
    mapInstance.on('mouseleave', 'clusters-rectangles-fill', () => {
      mapInstance.getCanvas().style.cursor = ''
    })

    mapInstance.on('click', 'clusters-circle', (e) => {
      if (isDrawingMode.value) return
      const features = mapInstance.queryRenderedFeatures(e.point, {
        layers: ['clusters-circle'],
      })
      if (features.length > 0) {
        const clusterId = features[0].properties.clusterId
        const currentlySelected = isClusterSelected({ id: clusterId })
        skipFitMapOnClusterClick = true
        urlFilters.toggleFilter('clusters', clusterId, !currentlySelected)
      }
    })

    mapInstance.on('click', 'clusters-unclustered', (e) => {
      if (isDrawingMode.value) return
      const features = mapInstance.queryRenderedFeatures(e.point, {
        layers: ['clusters-unclustered'],
      })
      if (features.length > 0) {
        const clusterId = features[0].properties.clusterId
        const currentlySelected = isClusterSelected({ id: clusterId })
        skipFitMapOnClusterClick = true
        urlFilters.toggleFilter('clusters', clusterId, !currentlySelected)
      }
    })

    mapInstance.on('mouseenter', 'clusters-circle', () => {
      mapInstance.getCanvas().style.cursor = 'pointer'
    })
    mapInstance.on('mouseleave', 'clusters-circle', () => {
      mapInstance.getCanvas().style.cursor = ''
    })
    mapInstance.on('mouseenter', 'clusters-unclustered', () => {
      mapInstance.getCanvas().style.cursor = 'pointer'
    })
    mapInstance.on('mouseleave', 'clusters-unclustered', () => {
      mapInstance.getCanvas().style.cursor = ''
    })

    let hoverPopup = null
    const showClusterPopup = (e) => {
      if (hoverPopup) {
        hoverPopup.remove()
        hoverPopup = null
      }
      const features = mapInstance.queryRenderedFeatures(e.point, {
        layers: ['clusters-circle', 'clusters-unclustered'],
      })
      if (features.length > 0) {
        const fProps = features[0].properties
        const clusterId = fProps.clusterId
        const cluster = findClusterById(clusterId)
        if (!cluster) return
        const placeNames =
          (cluster.placeIds || [])
            .map((pid) => eventsPlaces.value.find((p) => p.id === pid)?.name)
            .filter(Boolean)
            .join(', ') || t('map.popupNoPlace')
        hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
          .setLngLat([cluster.longitude, cluster.latitude])
          .setHTML(
            `<b>${cluster.name}</b><br>${placeNames}<br>${t('map.events')} ${cluster.count}<br>${t('map.photos')} ${cluster.mediaCount}`,
          )
          .addTo(mapInstance)
      }
    }
    const hideClusterPopup = () => {
      if (hoverPopup) {
        hoverPopup.remove()
        hoverPopup = null
      }
    }

    mapInstance.on('mouseenter', 'clusters-circle', showClusterPopup)
    mapInstance.on('mouseleave', 'clusters-circle', hideClusterPopup)
    mapInstance.on('mouseenter', 'clusters-unclustered', showClusterPopup)
    mapInstance.on('mouseleave', 'clusters-unclustered', hideClusterPopup)

    if (zoomHandler) {
      mapInstance.off('zoomend', zoomHandler)
    }
    zoomHandler = () => {
      updateAllRectangles()
    }
    mapInstance.on('zoomend', zoomHandler)
  }

  const applyMapTheme = (theme) => {
    if (!mapInstance) return
    const stylePath =
      theme === 'dark'
        ? '/map-styles/dark-matter-gl-style/style.json'
        : '/map-styles/positron-gl-style/style.json'

    const onStyleLoad = () => {
      addCustomMapLayers()
      mapInstance.once('idle', () => {
        if (!mapInstance) return
        mapInstance.resize()
        if (isSimpleMode.value) {
          addSimpleMarker()
        } else {
          fitMapToClusters()
        }
      })
    }

    mapInstance.once('style.load', onStyleLoad)
    mapInstance.setStyle(stylePath)
  }

  const initMap = async () => {
    try {
      const maplibregl = await loadMapLibre()
      const container = mapContainer.value
      if (!container) return

      const stylePath =
        currentTheme.value === 'dark'
          ? '/map-styles/dark-matter-gl-style/style.json'
          : '/map-styles/positron-gl-style/style.json'

      mapInstance = new maplibregl.Map({
        container: container,
        style: stylePath,
        center: [0, 0],
        zoom: 0,
      })

      mapInstance.on('load', () => {
        setupResizeObserver()
        setupVisibilityObserver()
        mapInstance.resize()
        addCustomMapLayers()
        if (isSimpleMode.value) {
          nextTick(() => {
            mapInstance.resize()
            addSimpleMarker()
          })
        } else {
          mapInstance.once('idle', () => {
            if (!mapInstance) return
            mapInstance.resize()
            fitMapToClusters()
            const renderAfterFit = () => {
              if (!mapInstance) return
              mapInstance.resize()
              updateAllRectangles()
              updateClustersGeoJSON()
            }
            mapInstance.once('moveend', renderAfterFit)
            setTimeout(renderAfterFit, 800)
          })
        }
      })
    } catch (err) {
      console.error('Failed to load MapLibre:', err)
    }
  }

  const destroyMap = () => {
    if (mapInstance) {
      if (zoomHandler) {
        mapInstance.off('zoomend', zoomHandler)
      }
      if (mapInstance.getLayer('places-polygons-fill')) {
        mapInstance.removeLayer('places-polygons-fill')
      }
      if (mapInstance.getLayer('places-polygons-outline')) {
        mapInstance.removeLayer('places-polygons-outline')
      }
      if (mapInstance.getSource('places-polygons')) {
        mapInstance.removeSource('places-polygons')
      }
      if (mapInstance.getLayer('clusters-heatmap')) {
        mapInstance.removeLayer('clusters-heatmap')
      }
      if (mapInstance.getSource('clusters-geojson')) {
        mapInstance.removeSource('clusters-geojson')
      }
      if (mapInstance.getLayer('clusters-rectangles-fill')) {
        mapInstance.removeLayer('clusters-rectangles-fill')
      }
      if (mapInstance.getLayer('clusters-rectangles-stroke')) {
        mapInstance.removeLayer('clusters-rectangles-stroke')
      }
      if (mapInstance.getSource('clusters-rectangles')) {
        mapInstance.removeSource('clusters-rectangles')
      }
      if (mapInstance.getLayer('clusters-count')) {
        mapInstance.removeLayer('clusters-count')
      }
      if (mapInstance.getLayer('clusters-circle')) {
        mapInstance.removeLayer('clusters-circle')
      }
      if (mapInstance.getLayer('clusters-unclustered')) {
        mapInstance.removeLayer('clusters-unclustered')
      }
      if (mapInstance.getLayer('clusters-unclustered-count')) {
        mapInstance.removeLayer('clusters-unclustered-count')
      }
      if (mapInstance.getLayer('clusters-heatmap')) {
        mapInstance.removeLayer('clusters-heatmap')
      }
      if (mapInstance.getSource('clusters-heatmap-raw')) {
        mapInstance.removeSource('clusters-heatmap-raw')
      }
      if (mapInstance.getSource('clusters-geojson')) {
        mapInstance.removeSource('clusters-geojson')
      }
      if (simpleMarker) {
        simpleMarker.remove()
        simpleMarker = null
      }
      if (drawControl) {
        mapInstance.removeControl(drawControl)
        drawControl = null
      }
      clearHoveredHighlight()
      teardownResizeObserver()
      teardownVisibilityObserver()
      if (rafId) cancelAnimationFrame(rafId)
      mapInstance.remove()
      mapInstance = null
    }
  }

  const LAT_STEP_DEG = 0.0009
  const LNG_STEP_EQ = 0.0009
  const LNG_STEP_TEMP = 0.0013
  const LNG_STEP_POLAR = 0.0035

  const getLngStep = (lat) => {
    const absLat = Math.abs(lat)
    if (absLat < 30) return LNG_STEP_EQ
    if (absLat < 60) return LNG_STEP_TEMP
    return LNG_STEP_POLAR
  }

  const getCellBounds = (lat, lng) => {
    const latIdx = Math.floor(lat / LAT_STEP_DEG)
    const lngStep = getLngStep(lat)
    const lngIdx = Math.floor(lng / lngStep)
    const minLat = latIdx * LAT_STEP_DEG
    const maxLat = minLat + LAT_STEP_DEG
    const minLng = lngIdx * lngStep
    const maxLng = minLng + lngStep
    return [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ]
  }

  const updatePlacesPolygons = (extraPolygon = null) => {
    if (!mapInstance || !mapInstance.getSource('places-polygons')) return
    const features = []
    const places = filterContext?.places?.value || []
    places.forEach((place) => {
      if (place.polygon && place.id !== currentPlaceIdForPolygon.value) {
        const geometry = normalizePolygon(place.polygon)
        if (geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')) {
          const isSelected = selectedPlaces.value.includes(place.name)
          features.push({
            type: 'Feature',
            id: place.id,
            properties: { placeId: place.id, selected: isSelected },
            geometry: geometry,
          })
        }
      }
    })
    if (extraPolygon) {
      features.push(extraPolygon)
    }
    mapInstance.getSource('places-polygons').setData({
      type: 'FeatureCollection',
      features: features,
    })
  }

  const updateAllRectangles = () => {
    if (!mapInstance || !mapInstance.getSource('clusters-rectangles')) return
    if (!isMapVisible.value) return
    const zoom = mapInstance.getZoom()
    if (zoom < MAP_ZOOM.cluster.rectangleMin) {
      mapInstance.getSource('clusters-rectangles').setData({
        type: 'FeatureCollection',
        features: [],
      })
      return
    }
    const features = clusters.value
      .filter((c) => c.latitude != null && c.longitude != null && c.count > 0)
      .map((cluster) => {
        const bounds = getCellBounds(cluster.latitude, cluster.longitude)
        const isSelected = isClusterHighlighted(cluster)
        const fillOpacity = getRectangleOpacity(cluster.mediaCount, isSelected)
        return {
          type: 'Feature',
          id: cluster.id,
          properties: {
            clusterId: cluster.id,
            count: cluster.count,
            mediaCount: cluster.mediaCount,
            selected: isSelected,
            fillOpacity: fillOpacity,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [bounds],
          },
        }
      })
    mapInstance.getSource('clusters-rectangles').setData({
      type: 'FeatureCollection',
      features: features,
    })
  }

  const updateClustersGeoJSON = () => {
    if (!mapInstance || !mapInstance.getSource('clusters-geojson')) return
    const filtered = getFilteredClusters()
    const features = filtered.map((c) => {
      const isSelected = isClusterSelected(c)
      const base = Math.min((c.mediaCount || 1) * 0.03, 1.0)
      const pointOpacity = Math.max(0.3, base)
      return {
        type: 'Feature',
        properties: {
          clusterId: c.id,
          count: c.count,
          mediaCount: c.mediaCount,
          name: c.name || '',
          placeIds: c.placeIds || [],
          selected: isSelected,
          pointOpacity: pointOpacity,
          countLabel: formatCount(c.mediaCount),
        },
        geometry: { type: 'Point', coordinates: [c.longitude, c.latitude] },
      }
    })
    const data = { type: 'FeatureCollection', features }
    mapInstance.getSource('clusters-geojson').setData(data)
    if (mapInstance.getSource('clusters-heatmap-raw')) {
      mapInstance.getSource('clusters-heatmap-raw').setData(data)
    }
  }

  const getFilteredClusters = () => {
    const selectedPlaceIds = eventsPlaces.value
      .filter((p) => selectedPlaces.value.includes(p.name))
      .map((p) => p.id)
    return clusters.value.filter((c) => {
      if (c.latitude == null || c.longitude == null || c.count <= 0) return false
      if (selectedClusterIds.value.length === 0 && selectedPlaceIds.length === 0) return true
      if (selectedClusterIds.value.includes(c.id)) return true
      if (selectedPlaceIds.length === 0) return false
      return (c.placeIds || []).some((pid) => selectedPlaceIds.includes(pid))
    })
  }

  const findClusterById = (clusterId) => {
    return getFilteredClusters().find((c) => c.id === clusterId) || null
  }

  const fitMapToClusters = () => {
    if (!mapInstance || isSimpleMode.value) return

    const filtered = getFilteredClusters()
    const coords = filtered
      .map((p) => [p.longitude, p.latitude])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))

    if (coords.length > 0) {
      const bounds = new maplibregl.LngLatBounds()
      coords.forEach((coord) => bounds.extend(coord))
      mapInstance.fitBounds(bounds, { padding: 30, maxZoom: 17 })
    }
  }

  const startPolygonDrawing = async (placeId) => {
    currentPlaceIdForPolygon.value = placeId
    isDrawingMode.value = true
    updatePlacesPolygons()
    await loadMapLibreDraw()

    if (!drawControl) {
      const draw = new MapboxDraw({
        displayControlsDefault: false,
        //     styles: [
        //   // 1. Inactive polygon (Fill)
        //   {
        //     'id': 'gl-draw-polygon-fill-inactive',
        //     'type': 'fill',
        //     'filter': ['all',
        //       ['==', '$type', 'Polygon'],
        //       ['!=', 'mode', 'static'],
        //       ['==', 'active', 'false']
        //     ],
        //     'paint': {
        //       'fill-color': '#ff0000',
        //       'fill-opacity': 0.4
        //     }
        //   },
        //   // 2. Active polygon when selected (Fill)
        //   {
        //     'id': 'gl-draw-polygon-fill-active',
        //     'type': 'fill',
        //     'filter': ['all',
        //       ['==', '$type', 'Polygon'],
        //       ['==', 'active', 'true']
        //     ],
        //     'paint': {
        //       'fill-color': '#ff0000',
        //       'fill-opacity': 0.6
        //     }
        //   },
        //   // 3. Inactive outline
        //   {
        //     'id': 'gl-draw-polygon-stroke-inactive',
        //     'type': 'line',
        //     'filter': ['all',
        //       ['==', '$type', 'Polygon'],
        //       ['!=', 'mode', 'static'],
        //       ['==', 'active', 'false']
        //     ],
        //     'layout': {
        //       'line-cap': 'round',
        //       'line-join': 'round'
        //     },
        //     'paint': {
        //       'line-color': '#ff0000',
        //       'line-width': 1
        //     }
        //   },
        //   // 4. Active outline (during editing)
        //   {
        //     'id': 'gl-draw-polygon-stroke-active',
        //     'type': 'line',
        //     'filter': ['all',
        //       ['==', '$type', 'Polygon'],
        //       ['==', 'active', 'true']
        //     ],
        //     'layout': {
        //       'line-cap': 'round',
        //       'line-join': 'round'
        //     },
        //     'paint': {
        //       'line-color': '#ff0000',
        //       'line-width': 2 // Made line thicker for selection
        //     }
        //   },
        //   // 5. Vertex points (REQUIRED FOR GEOMETRY EDITING)
        //   {
        //     'id': 'gl-draw-polygon-and-line-vertex-inactive',
        //     'type': 'circle',
        //     'filter': ['all',
        //       ['==', 'meta', 'vertex'],
        //       ['==', '$type', 'Point'],
        //       ['!=', 'mode', 'static']
        //     ],
        //     'paint': {
        //       'circle-radius': 5,
        //       'circle-color': '#ffffff',
        //       'circle-stroke-color': '#ff0000',
        //       'circle-stroke-width': 2
        //     }
        //   }
        // ],
        controls: {
          polygon: true,
          trash: true,
        },
        defaultMode: 'simple_select',
      })
      mapInstance.addControl(draw, 'top-right')
      drawControl = draw
    }

    mapInstance.on('draw.delete', onPolygonDeleted)

    let place = eventsPlaces.value.find((p) => p.id === placeId)
    let geometry = null

    if (!place || !place.polygon) {
      try {
        const res = await fetch(`/api/places/${placeId}`, {
          headers: {
            Authorization: token.value ? `Bearer ${token.value}` : '',
          },
        })
        if (res.ok) {
          const data = await res.json()
          place = data.success ? data.data : data
        }
      } catch (e) {
        console.error('Failed to load place for polygon editing', e)
      }
    }

    if (place && place.polygon) {
      geometry = normalizePolygon(place.polygon)
      if (geometry) {
        drawControl.add({
          type: 'Feature',
          properties: {},
          geometry: geometry,
        })
        drawControl.changeMode('simple_select')
        const coords =
          geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0]
        if (coords && coords.length > 0) {
          const bounds = new maplibregl.LngLatBounds()
          coords.forEach(([lng, lat]) => bounds.extend([lng, lat]))
          mapInstance.fitBounds(bounds, { padding: 80, maxZoom: MAP_ZOOM.fitBounds.polygon })
        }
      }
    }

    if (drawControl && !geometry) {
      drawControl.changeMode('draw_polygon')
    }
  }

  const onPolygonDeleted = () => {
    if (drawControl) {
      const features = drawControl.getAll()
      if (features.features.length === 0) {
        stopPolygonDrawing()
      }
    }
  }

  const savePolygon = async () => {
    if (!drawControl) return
    const features = drawControl.getAll()
    if (features.features.length === 0) {
      stopPolygonDrawing()
      return
    }
    const feature = features.features[0]
    const geometry = feature.geometry
    let coords = null
    if (geometry.type === 'Polygon' && geometry.coordinates[0]) {
      coords = geometry.coordinates[0].map(([lng, lat]) => [lat, lng])
    } else if (
      geometry.type === 'MultiPolygon' &&
      geometry.coordinates[0] &&
      geometry.coordinates[0][0]
    ) {
      coords = geometry.coordinates[0][0].map(([lng, lat]) => [lat, lng])
    }
    const placeId = currentPlaceIdForPolygon.value
    try {
      const res = await fetch(`/api/places/${placeId}/polygon`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token.value ? `Bearer ${token.value}` : '',
        },
        body: JSON.stringify({ polygon: coords }),
      })
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(errText || t('map.error.savePolygon'))
      }
      addNotification('success', t('polygon.saved'))
      emit('polygon-saved')
      stopPolygonDrawing({
        type: 'Feature',
        id: placeId,
        properties: { placeId: placeId },
        geometry: feature.geometry,
      })
      if (filterContext?.loadPlaces) {
        filterContext.loadPlaces()
      }
    } catch (e) {
      console.error('Failed to save polygon:', e)
      addNotification('error', t('polygon.saveError'))
      stopPolygonDrawing()
    }
  }

  const cancelPolygon = () => {
    stopPolygonDrawing()
  }

  const stopPolygonDrawing = (savedPolygon = null) => {
    if (drawControl) {
      mapInstance.removeControl(drawControl)
      drawControl = null
    }
    mapInstance.off('draw.delete', onPolygonDeleted)
    isDrawingMode.value = false
    currentPlaceIdForPolygon.value = null
    updatePlacesPolygons(savedPolygon)
  }

  watch(
    clustersState.clusters,
    () => {
      if (!mapInstance || isSimpleMode.value) return
      updateClustersGeoJSON()
      updateAllRectangles()
      if (!skipFitMapOnClusterClick && !skipFitMapOnExternalUrlChange.value) {
        fitMapToClusters()
      }
      skipFitMapOnClusterClick = false
    },
    { deep: true },
  )

  watch(
    selectedClusterIds,
    () => {
      if (isSimpleMode.value) return
      updateAllRectangles()
      updateClustersGeoJSON()
      if (!skipFitMapOnClusterClick && !skipFitMapOnExternalUrlChange.value) {
        fitMapToClusters()
      }
      skipFitMapOnClusterClick = false
    },
    { deep: true },
  )

  watch(
    selectedPlaces,
    () => {
      if (!mapInstance || isSimpleMode.value) return
      updateAllRectangles()
      updateClustersGeoJSON()
      updatePlacesPolygons()
      if (!skipFitMapOnClusterClick && !skipFitMapOnExternalUrlChange.value) {
        fitMapToClusters()
      }
      skipFitMapOnClusterClick = false
    },
    { deep: true },
  )

  watch(
    eventsPlaces,
    () => {
      if (isSimpleMode.value) return
      updateAllRectangles()
      updateClustersGeoJSON()
      updatePlacesPolygons()
    },
    { deep: true },
  )

  watch(currentTheme, (theme) => {
    applyMapTheme(theme)
  })

  watch(
    () => props.location,
    (newLocation) => {
      if (newLocation && mapInstance) {
        addSimpleMarker()
      } else if (simpleMarker) {
        simpleMarker.remove()
        simpleMarker = null
      }
    },
    { deep: true },
  )

  watch(isMapVisible, (visible) => {
    if (!visible || !mapInstance || isSimpleMode.value) return
    updateAllRectangles()
    updateClustersGeoJSON()
  })

  watch(
    () => urlFilters.filters,
    () => {
      if (isSimpleMode.value) return
      clustersState.loadClusters()
    },
    { deep: true },
  )

  provide('clustersContext', {
    clusters,
    currentClusterId,
    loadClusters: clustersState.loadClusters,
    reloadClusters: clustersState.reload,
    selectCluster: (clusterId) => urlFilters.toggleFilter('clusters', clusterId, true),
  })

  onMounted(async () => {
    if (!isSimpleMode.value) {
      await new Promise((resolve) =>
        window.addEventListener('ws:server-ready', resolve, { once: true }),
      )
    }

    try {
      if (!isSimpleMode.value) {
        await clustersState.loadClusters()
      }
      isLoading.value = false
      await new Promise((resolve) => setTimeout(resolve, 100))
      await initMap()
    } catch (err) {
      console.error('Initialization error:', err)
      isLoading.value = false
    }
  })

  onBeforeUnmount(() => {
    destroyMap()
    if (externalUrlResetTimer) {
      clearTimeout(externalUrlResetTimer)
      externalUrlResetTimer = null
    }
  })

  defineExpose({ startPolygonDrawing, markExternalUrlChange, reloadClusters: clustersState.reload })
</script>
