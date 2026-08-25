<template>
  <div v-if="items.length > 0" class="filter-section">
    <h4>{{ title }}</h4>
    <ul>
      <li v-for="item in items" :key="getItemKey(item)">
        <TagBadge
          :name="getItemName(item)"
          :type="type"
          :count="counts[getItemName(item)]"
          :disabled="counts[getItemName(item)] === 0"
          :selectable="true"
          :selected="selected.includes(getItemName(item))"
          :place-data="filterType === 'places' ? item : null"
          @update:selected="onChange(getItemName(item), $event)"
          @contextmenu.prevent="onContextMenu($event, filterType, item)"
          @hover="onHover($event)"
        />
      </li>
    </ul>
  </div>
</template>

<script setup>
  import TagBadge from '../ui/TagBadge.vue'

  const props = defineProps({
    title: { type: String, required: true },
    items: { type: Array, required: true },
    type: { type: String, default: 'tag' },
    keyField: { type: String, default: 'name' },
    selected: { type: Array, required: true },
    counts: { type: Object, required: true },
    filterType: { type: String, required: true },
    hasContextMenu: { type: Boolean, default: true },
  })

  const emit = defineEmits(['change', 'context-menu', 'hover'])

  const getItemKey = (item) => (typeof item === 'object' ? item.id : item)
  const getItemName = (item) => (typeof item === 'object' ? item[props.keyField] : item.toString())

  const onChange = (name, event) => {
    emit('change', props.filterType, name, event)
  }

  const onContextMenu = (event, type, item) => {
    if (props.hasContextMenu) {
      emit('context-menu', event, type, item)
    }
  }

  const onHover = (placeData) => {
    emit('hover', placeData)
  }
</script>
