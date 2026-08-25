<template>
  <div class="timeline">
    <!-- Year blocks -->
    <div v-for="year in visibleYears" :key="year" class="year-block" :data-year="year">
      <!-- Year header -->
      <h2 class="year-header">{{ year }}</h2>

      <!-- Year events -->
      <EventCard
        v-for="event in eventsByYear[year]?.events"
        :key="event.id"
        :event="event"
        :is-editing="editingEvent && event.id === editingEvent.id"
        @edit-event="openEditModal"
      />
    </div>

    <!-- Loading states (indicator, button, end of list, no events) -->
    <LoadMoreTrigger
      :loading="loading"
      :has-more="hasMore"
      :total-events-count="totalEventsCount"
      :db-has-events="dbHasEvents"
      @load-more="loadEvents(true)"
    />
  </div>
</template>

<script setup>
  import { inject } from 'vue'
  import EventCard from '../components/events/EventCard.vue'
  import LoadMoreTrigger from '../components/events/LoadMoreTrigger.vue'

  // Get data and methods from App.vue via provide/inject
  const {
    eventsByYear,
    visibleYears,
    loading,
    hasMore,
    totalEventsCount,
    dbHasEvents,
    loadEvents,
    openEditModal,
    editingEvent,
  } = inject('timelineContext')
</script>
