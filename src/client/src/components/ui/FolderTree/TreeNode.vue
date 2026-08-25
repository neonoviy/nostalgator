<template>
  <div class="tree-node">
    <div class="tree-node-row" :style="{ paddingLeft: depth * 16 + 'px' }">
      <span
        v-if="depth > 0 && node.children && node.children.length"
        class="tree-toggle"
        @click="toggle"
      >
        <span :class="isExpanded ? 'tree-toggle__caret tree-toggle__caret--down' : 'tree-toggle__caret tree-toggle__caret--right'"></span>
      </span>
      <span v-else class="tree-toggle-spacer"></span>
      <AppCheckbox :checked="isChecked" :indeterminate="isIndeterminate" @change="onChange">
        <span>{{ node.name }}</span>
      </AppCheckbox>
    </div>
    <div v-if="(depth === 0 || isExpanded) && node.children && node.children.length">
      <TreeNode
        v-for="child in node.children"
        :key="child.path || child.name"
        :node="child"
        :selected-paths="selectedPaths"
        :expanded-paths="expandedPaths"
        :depth="depth + 1"
        @toggle="$emit('toggle', $event)"
        @check="$emit('check', $event)"
      />
    </div>
  </div>
</template>

<script setup>
  import { computed } from 'vue'
  import AppCheckbox from '../AppCheckbox.vue'

  const props = defineProps({
    node: {
      type: Object,
      required: true,
    },
    selectedPaths: {
      type: Array,
      required: true,
    },
    expandedPaths: {
      type: Object,
      required: true,
    },
    depth: {
      type: Number,
      default: 0,
    },
  })

  const emit = defineEmits(['toggle', 'check'])

  const isExpanded = computed(() => {
    const key = props.node.path !== undefined ? props.node.path : props.node.name
    return !!props.expandedPaths[key]
  })

  function toggle() {
    const key = props.node.path !== undefined ? props.node.path : props.node.name
    emit('toggle', key)
  }

  function getLeafPaths(node) {
    const key = node.path !== undefined ? node.path : node.name
    if (!node.children || node.children.length === 0) {
      return [key]
    }
    return node.children.flatMap(getLeafPaths)
  }

  function onChange(checked) {
    emit('check', { node: props.node, checked, leafPaths: leafPaths.value })
  }

  const selectedSet = computed(() => new Set(props.selectedPaths))

  const leafPaths = computed(() => getLeafPaths(props.node))

  function isLeafSelected(leafPath) {
    if (selectedSet.value.has('')) return true
    if (selectedSet.value.has(leafPath)) return true
    const parts = leafPath.split('/').filter(Boolean)
    if (parts.length >= 2 && selectedSet.value.has(parts[0])) return true
    return false
  }

  // Tri-state checkbox: checked when all leaf paths under this node are selected
  const isChecked = computed(() => {
    if (leafPaths.value.length === 0) return false
    return leafPaths.value.every(isLeafSelected)
  })

  // Tri-state checkbox: indeterminate when some but not all leaf paths are selected
  const isIndeterminate = computed(() => {
    if (leafPaths.value.length === 0) return false
    const selectedCount = leafPaths.value.filter(isLeafSelected).length
    return selectedCount > 0 && selectedCount < leafPaths.value.length
  })
</script>


