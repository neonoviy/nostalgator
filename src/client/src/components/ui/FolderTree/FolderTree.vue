<template>
  <div class="folder-tree">
    <TreeNode
      :node="tree"
      :selected-paths="selectedPaths"
      :expanded-paths="expandedPaths"
      :depth="0"
      @toggle="handleToggle"
      @check="handleCheck"
    />
  </div>
</template>

<script setup>
  import { ref, watch } from 'vue'
  import TreeNode from './TreeNode.vue'

  const props = defineProps({
    modelValue: {
      type: Array,
      default: () => [],
    },
    tree: {
      type: Object,
      required: true,
    },
  })

  const emit = defineEmits(['update:modelValue'])

  const selectedPaths = ref([...props.modelValue])
  const expandedPaths = ref({ '': true })

  function getLeafPaths(node) {
    const key = node.path !== undefined ? node.path : node.name
    if (!node.children || node.children.length === 0) {
      return [key]
    }
    return node.children.flatMap(getLeafPaths)
  }

  function buildNodeMap(node, map = new Map()) {
    const key = node.path !== undefined ? node.path : node.name
    map.set(key, node)
    if (node.children) {
      for (const child of node.children) {
        buildNodeMap(child, map)
      }
    }
    return map
  }

  function isLeafPathSelected(leafPath, selectedPaths) {
    const selectedSet = new Set(selectedPaths)
    if (selectedSet.has('')) return true
    if (selectedSet.has(leafPath)) return true
    const parts = leafPath.split('/').filter(Boolean)
    if (parts.length >= 2 && selectedSet.has(parts[0])) return true
    return false
  }

  function getIndeterminatePaths(node, selectedPaths, result = new Set()) {
    const key = node.path !== undefined ? node.path : node.name
    const leafPaths = getLeafPaths(node)

    if (leafPaths.length > 0) {
      const selectedCount = leafPaths.filter((p) => isLeafPathSelected(p, selectedPaths)).length
      if (selectedCount > 0 && selectedCount < leafPaths.length) {
        result.add(key)
      }
    }

    if (node.children) {
      for (const child of node.children) {
        getIndeterminatePaths(child, selectedPaths, result)
      }
    }

    return result
  }

  // Normalize paths: expand root selection '' into all leaf paths on load
  function normalizePaths(paths, tree) {
    const nodeMap = buildNodeMap(tree)
    return paths
      .map((p) => {
        if (p === '') {
          const root = nodeMap.get('') || tree
          return getLeafPaths(root)
        }
        if (!nodeMap.has(p)) return p
        const node = nodeMap.get(p)
        if (node.children && node.children.length > 0) {
          return getLeafPaths(node)
        }
        return p
      })
      .flat()
  }

  // Compress selection to root: return [""] when all leaves are selected
  function compressPaths(paths, tree) {
    if (!tree) return paths
    if (paths.length === 0) return []

    const nodeMap = buildNodeMap(tree)
    const allLeafPaths = getLeafPaths(tree)
    const selectedSet = new Set(paths)

    if (allLeafPaths.length > 0 && allLeafPaths.every((p) => selectedSet.has(p))) {
      return ['']
    }

    const result = []
    const yearSelected = new Set()
    const eventGroups = new Map()

    for (const p of paths) {
      if (p === '') {
        const root = nodeMap.get('') || tree
        return getLeafPaths(root)
      }
      const parts = p.split('/').filter(Boolean)
      if (parts.length === 1) {
        yearSelected.add(parts[0])
      } else if (parts.length >= 2) {
        const year = parts[0]
        if (!eventGroups.has(year)) eventGroups.set(year, new Set())
        eventGroups.get(year).add(p)
      }
    }

    for (const year of yearSelected) {
      result.push(year)
    }

    for (const [year, selectedEvents] of eventGroups) {
      if (yearSelected.has(year)) continue
      const yearNode = nodeMap.get(year)
      if (!yearNode) continue
      const allEvents = getLeafPaths(yearNode)
      const allSelected = allEvents.length > 0 && allEvents.every((e) => selectedEvents.has(e))
      if (allSelected) {
        result.push(year)
      } else {
        result.push(...selectedEvents)
      }
    }

    return result
  }

  watch(
    () => [props.tree, props.modelValue],
    ([tree, modelValue]) => {
      if (tree) {
        selectedPaths.value = normalizePaths([...modelValue], tree)
        const indeterminatePaths = getIndeterminatePaths(tree, selectedPaths.value)
        for (const path of indeterminatePaths) {
          expandedPaths.value[path] = true
        }
      }
    },
    { immediate: true },
  )

  function handleToggle(path) {
    expandedPaths.value[path] = !expandedPaths.value[path]
  }

  // Handle checkbox change: update selection then compress paths to root
  function handleCheck(payload) {
    const { checked, leafPaths } = payload
    const next = new Set(selectedPaths.value)

    if (checked) {
      leafPaths.forEach((p) => next.add(p))
    } else {
      leafPaths.forEach((p) => next.delete(p))
    }

    selectedPaths.value = Array.from(next)
    emit('update:modelValue', compressPaths(selectedPaths.value, props.tree))

    const indeterminatePaths = getIndeterminatePaths(props.tree, selectedPaths.value)
    for (const path of indeterminatePaths) {
      expandedPaths.value[path] = true
    }
  }
</script>


