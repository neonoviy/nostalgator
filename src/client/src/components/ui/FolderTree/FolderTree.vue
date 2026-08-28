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

  // One-level folder fetch from the backend (lazy loading).
  async function loadChildren(nodePath) {
    const authToken = localStorage.getItem('auth_token')
    const response = await fetch(
      '/api/scan/folders?path=' + encodeURIComponent(nodePath || ''),
      {
        headers: {
          Authorization: authToken ? `Bearer ${authToken}` : '',
          'Cache-Control': 'no-cache',
        },
      },
    )
    if (!response.ok) throw new Error('Failed to load folders')
    const result = await response.json()
    return result.data || result
  }

  // Fetch a node's children and attach them to the live tree node.
  async function attachChildren(node) {
    const key = node.path !== undefined ? node.path : node.name
    const data = await loadChildren(key)
    const map = buildNodeMap(props.tree)
    const target = map.get(key) || node
    target.children = data.children
    target.hasChildren = data.hasChildren
    target.loaded = true
    return target
  }

  // Selected paths are already explicit (years / events); just drop the legacy
  // "All" sentinel and keep the rest as-is.
  function normalizePaths(paths) {
    return paths.filter((p) => p !== '')
  }

  // A path is considered selected if it (or any ancestor) is in the set.
  function isPathSelected(p, selectedSet) {
    if (selectedSet.has(p)) return true
    const parts = p.split('/').filter(Boolean)
    let acc = ''
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      if (selectedSet.has(acc)) return true
    }
    return false
  }

  // Compress the selection to the minimal set the backend needs.
  // A node that is selected (or whose all loaded children are selected) is
  // emitted as its own path (e.g. checking a year, or all its events, yields
  // the year); a partially-selected node emits its checked children.
  function compressPaths(paths, tree) {
    if (!tree) return paths
    if (paths.length === 0) return []
    const selectedSet = new Set(paths)
    const result = []

    function walk(node) {
      const key = node.path !== undefined ? node.path : node.name
      if (selectedSet.has(key)) {
        result.push(key)
        return
      }
      const children = node.children || []
      if (children.length === 0) return
      const leaves = getLeafPaths(node)
      if (leaves.length > 0 && leaves.every((p) => isPathSelected(p, selectedSet))) {
        // All children selected: emit the parent. The root ("") means "all",
        // which is represented by an empty selection.
        if (key !== '') result.push(key)
        return
      }
      const before = result.length
      for (const child of children) {
        walk(child)
      }
      if (result.length === before) {
        // No loaded child matched: forward any selected descendant paths.
        for (const p of selectedSet) {
          if (p !== key && p.startsWith(key + '/')) result.push(p)
        }
      }
    }

    walk(tree)
    return result
  }

  // Ensure a selected path (e.g. from preSelectedFolder) is visible: load its
  // ancestor chain on demand and expand it so the checkbox is shown.
  async function revealPath(targetPath) {
    if (!props.tree || !targetPath) return
    const parts = targetPath.split('/').filter(Boolean)
    // Top-level (year) selections are shown via the checkbox without forcing
    // expansion; only deeper paths (e.g. preSelectedFolder events) are revealed.
    if (parts.length <= 1) return
    let current = props.tree
    let accumulated = ''
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]
      accumulated = accumulated ? `${accumulated}/${seg}` : seg
      let child = (current.children || []).find(
        (c) => (c.path !== undefined ? c.path : c.name) === accumulated,
      )
      if (!child && current.hasChildren && !current.loaded) {
        current = await attachChildren(current)
        child = (current.children || []).find(
          (c) => (c.path !== undefined ? c.path : c.name) === accumulated,
        )
      }
      if (!child) return
      expandedPaths.value[accumulated] = true
      current = child
    }
  }

  watch(
    () => [props.tree, props.modelValue],
    ([tree, modelValue]) => {
      if (!tree) return
      selectedPaths.value = normalizePaths([...modelValue])
      for (const p of selectedPaths.value) {
        revealPath(p)
      }
    },
    { immediate: true },
  )

  function handleToggle(path) {
    expandedPaths.value[path] = !expandedPaths.value[path]
    if (expandedPaths.value[path]) {
      const node = buildNodeMap(props.tree).get(path)
      if (node && node.hasChildren && !node.loaded) {
        attachChildren(node).catch((err) => console.error('Failed to load folders', err))
      }
    }
  }

  // Nearest checked ancestor of a path (excluding the path itself).
  function findCheckedAncestor(nodePath, selectedSet) {
    const parts = nodePath.split('/').filter(Boolean)
    for (let i = parts.length - 1; i >= 1; i--) {
      const acc = parts.slice(0, i).join('/')
      if (selectedSet.has(acc)) return acc
    }
    return null
  }

  // Handle checkbox change. Checking a node selects the node itself (not its
  // loaded children), so checking a year is always the year path. Unchecking a
  // node that is covered by a checked ancestor explodes the ancestor: removes
  // it and adds all other loaded siblings, turning it indeterminate.
  function handleCheck(payload) {
    const { checked, node } = payload
    const next = new Set(selectedPaths.value)
    const nodeKey = node.path !== undefined ? node.path : node.name

    if (checked) {
      next.add(nodeKey)
    } else {
      const ancestor = findCheckedAncestor(nodeKey, next)
      if (ancestor) {
        next.delete(ancestor)
        const map = buildNodeMap(props.tree)
        const ancestorNode = map.get(ancestor)
        if (ancestorNode) {
          const siblingLeaves = getLeafPaths(ancestorNode).filter(
            (p) => p !== nodeKey && !p.startsWith(nodeKey + '/'),
          )
          siblingLeaves.forEach((p) => next.add(p))
        }
      }
      next.delete(nodeKey)
    }

    selectedPaths.value = Array.from(next)
    emit('update:modelValue', compressPaths(selectedPaths.value, props.tree))
  }
</script>
