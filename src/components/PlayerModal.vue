<template>
  <div class="modal" @click.self="$emit('close')">
    <div class="modal-content" @click.stop>
      <button class="close" @click="$emit('close')">&times;</button>

      <h2 v-if="!activeGroup">Выберите плеер</h2>
      <h2 v-else>
        <button class="back-btn" @click="collapseGroup">← Назад</button>
        {{ activeGroup }}
      </h2>

      <ul class="players-list">
        <template v-if="!activeGroup">
          <li v-for="item in mixedPlayersList" :key="item.type === 'player' ? item.data.key : item.name">
            <button
              v-if="item.type === 'player'"
              :class="['player-item', { active: isSelected(item.data) }]"
              :title="item.data.translate && item.data.translate !== formatPlayerLabel(item.data) ? item.data.translate : undefined"
              @click="selectPlayer(item.data)"
            >
              {{ formatPlayerLabel(item.data) }}
              <span v-if="item.data.uhd" class="uhd-badge" title="Есть 2160p и 1440p">4K</span>
              <AppIcon v-if="item.data.warning" name="warning" :size="15" class="warning-icon" title="Внимание!" />
            </button>
            <button
              v-else
              :class="['group-item', { active: isGroupSelected(item.name) }]"
              @click="expandGroup(item.name)"
            >
              <AppIcon name="folder" :size="16" class="group-icon" />
              {{ item.displayName }}
              <AppIcon
                v-if="groupHasWarning(item.name)"
                name="warning"
                :size="15"
                class="warning-icon"
                title="Внимание!"
              />
            </button>
          </li>
        </template>
        <template v-else>
          <li v-for="player in groupPlayers(activeGroup)" :key="player.key">
            <button
              :class="['player-item', { active: isSelected(player) }]"
              :title="player.translate && player.translate !== formatPlayerLabel(player) ? player.translate : undefined"
              @click="selectPlayer(player)"
            >
              {{ formatPlayerLabel(player) }}
              <span v-if="player.uhd" class="uhd-badge" title="Есть 2160p и 1440p">4K</span>
              <AppIcon v-if="player.warning" name="warning" :size="15" class="warning-icon" title="Внимание!" />
            </button>
          </li>
        </template>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps({
  players: {
    type: Array,
    required: true
  },
  selectedPlayer: {
    type: Object,
    default: null
  }
})
const emit = defineEmits(['close', 'select'])

const activeGroup = ref(null)

const mixedPlayersList = computed(() => {
  const result = []
  const seenGroups = new Set()
  
  for (const player of props.players) {
    if (isVeoVeo(player)) {
      if (!seenGroups.has('veoveo')) {
        result.push({ type: 'group', name: 'veoveo', displayName: 'VeoVeo' })
        seenGroups.add('veoveo')
      }
    } else if (isKodik(player)) {
      if (!seenGroups.has('kodik')) {
        result.push({ type: 'group', name: 'kodik', displayName: 'Kodik' })
        seenGroups.add('kodik')
      }
    } else {
      result.push({ type: 'player', data: player })
    }
  }
  
  return result
})



const isVeoVeo = (player) => player.name.toUpperCase().includes('VEOVEO')
const isKodik = (player) => player.name.toUpperCase().includes('KODIK')

const cleanName = (name) =>
  String(name || '')
    .replace(/VEOVEO>/, '')
    .replace(/KODIK>/, '')
    .replace(/KINOBOX>/, '')
    .trim()

const getProviderName = (player) => {
  const directProvider = String(player?.provider || '').trim()
  if (directProvider) return cleanName(directProvider)

  const rawName = String(player?.name || player?.key || '')
  // Плееры из /playerdata kinobd называются просто ключом: «ALLOHA», «COLLAPS».
  // Раньше здесь возвращалась пустота, и подпись бралась из строки озвучек —
  // вместо «ALLOHA» в списке стояло «Украинский, Дубляж Red Head Sound, …».
  if (!rawName.includes('>')) return cleanName(rawName)

  const segments = rawName
    .split('>')
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (!segments.length) return ''

  const root = segments[0].toUpperCase()
  if ((root === 'KINOBOX' || root === 'KINOBD' || root === 'RHSERV') && segments[1]) {
    return cleanName(segments[1])
  }

  return cleanName(segments[0])
}

const formatPlayerLabel = (player) => {
  const provider = getProviderName(player)
  return provider || cleanName(player?.translate) || 'Плеер'
}

const selectPlayer = (player) => {
  emit('select', player)
  emit('close')
}

const isSelected = (player) => props.selectedPlayer && props.selectedPlayer.key === player.key

const isGroupSelected = (group) => {
  if (!props.selectedPlayer) return false
  return (
    (group === 'veoveo' && isVeoVeo(props.selectedPlayer)) ||
    (group === 'kodik' && isKodik(props.selectedPlayer))
  )
}

const expandGroup = (group) => {
  activeGroup.value = group
}
const collapseGroup = () => {
  activeGroup.value = null
}
const groupPlayers = (group) => {
  let players = props.players.filter(
    (player) => (group === 'veoveo' && isVeoVeo(player)) || (group === 'kodik' && isKodik(player))
  )

  if (group === 'kodik') {
    return players.sort((a, b) => formatPlayerLabel(a).localeCompare(formatPlayerLabel(b)))
  }

  return players
}
const groupHasWarning = (group) => groupPlayers(group).some((player) => player.warning)
</script>

<style scoped>
.modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 100;
}

.modal-content {
  background: rgba(8, 8, 8, 0.96);
  /* Минималистичная рамка как у модалки поиска (rgba 0.22) — без неонового свечения вокруг.
     Раньше было border: 1px solid var(--accent-color) + box-shadow: var(--neon-glow),
     что давало "двойное" жирное свечение. */
  border: 1px solid rgba(var(--accent-rgb), 0.22);
  padding: 18px 16px;
  border-radius: 10px;
  width: 90%;
  max-width: 340px;
  max-height: 70vh;
  overflow-y: auto;
  color: #fff;
  position: relative;
}

.modal-content::-webkit-scrollbar { width: 3px; }
.modal-content::-webkit-scrollbar-track { background: transparent; }
.modal-content::-webkit-scrollbar-thumb { background: var(--accent-color); border-radius: 4px; }

.close {
  position: absolute;
  top: 10px;
  right: 12px;
  border: none;
  background: transparent;
  color: rgba(255,255,255,0.4);
  font-size: 1.4rem;
  cursor: pointer;
  transition: color 0.2s;
  line-height: 1;
}
.close:hover { color: var(--accent-color); }

h2 {
  margin: 0 0 12px 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--accent-color);
  /* лёгкая cyan-подсветка текста вместо жёсткого неонового свечения */
  text-shadow: 0 0 6px rgba(var(--accent-rgb), 0.25);
  display: flex;
  align-items: center;
  gap: 6px;
}

.back-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-right: 6px;
  cursor: pointer;
  transition: color 0.2s;
}
.back-btn:hover { color: var(--accent-color); }

.players-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.uhd-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.4;
  vertical-align: middle;
  color: #0a0e1a;
  background: var(--accent-color, #00e5ff);
}

.player-item,
.group-item {
  width: 100%;
  text-align: left;
  padding: 7px 11px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 0.875rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  transition: all 0.2s ease;
}

.player-item:hover,
.group-item:hover {
  border-color: var(--accent-color);
  color: var(--accent-color);
  background: rgba(var(--accent-rgb), 0.08);
  box-shadow: 0 0 8px rgba(var(--accent-rgb), 0.15);
}

.player-item.active,
.group-item.active {
  /* Активный плеер выделен только cyan-обводкой и подсветкой текста.
     Неоновое свечение убрано чтобы было аккуратнее (как стиль модалки поиска). */
  border-color: var(--accent-color);
  color: var(--accent-color);
  background: rgba(var(--accent-rgb), 0.08);
}

.warning-icon {
  font-size: 0.95rem;
  color: var(--warning-color);
  margin-left: 8px;
}

.group-icon {
  font-size: 0.95rem;
  color: var(--text-muted);
  margin-right: 8px;
}

@media (max-width: 480px) {
  .modal-content { max-width: 95%; padding: 14px 12px; }
}
</style>

