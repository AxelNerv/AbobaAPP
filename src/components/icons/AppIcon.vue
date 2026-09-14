<template>
  <component
    :is="resolved"
    v-if="resolved"
    :size="size"
    :stroke-width="strokeWidth"
    :fill="filled ? 'currentColor' : 'none'"
    class="app-icon"
    :class="{ 'app-icon--filled': filled }"
    aria-hidden="true"
  />
</template>

<script setup>
/**
 * Единая точка для всех иконок сайта.
 *
 * Зачем: раньше на сайте одновременно жили три набора — FontAwesome (107
 * использований), Material Icons (31) и Material Symbols (4). Разная толщина
 * линий и разная манера рисунка в одном интерфейсе — из-за этого он и выглядел
 * несобранным. Плюс три внешние загрузки шрифтов.
 *
 * Теперь один Lucide: плоские SVG с единой обводкой, красятся через CSS
 * (stroke="currentColor"), тянутся только те, что реально используются.
 *
 * ВАЖНО про размер: шрифтовые иконки масштабировались через font-size, а SVG —
 * через width/height. Поэтому старые CSS-правила вроде
 * `.mobile-list-toggle .material-icons { font-size: 20px }` на SVG не влияют.
 * Размер задаётся пропом size (или CSS-классом .app-icon).
 */
import { computed } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Bell,
  CircleCheck,
  Maximize,
  Minimize,
  Moon,
  Sun,
  BellOff,
  Calendar,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  Copy,
  Dices,
  Download,
  Ellipsis,
  Eraser,
  ExternalLink,
  Folder,
  Hourglass,
  Palette,
  Share2,
  Upload,
  Eye,
  EyeOff,
  Film,
  Fingerprint,
  Flag,
  Globe,
  Heart,
  House,
  Info,
  Languages,
  Layers,
  Link,
  List,
  Lock,
  LogIn,
  Menu,
  Monitor,
  PictureInPicture2,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  Reply,
  RotateCcw,
  Save,
  Search,
  Settings,
  Sparkles,
  Star,
  StickyNote,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  Tv,
  Unplug,
  User,
  X
} from 'lucide-vue-next'

// Ключи — смысловые имена, а не названия из старых наборов: так при следующей
// смене набора править придётся только эту таблицу.
const ICONS = {
  // навигация и управление
  close: X,
  menu: Menu,
  home: House,
  search: Search,
  settings: Settings,
  back: ChevronLeft,
  forward: ChevronRight,
  up: ArrowUp,
  down: ArrowDown,
  more: Ellipsis,
  plus: Plus,
  list: List,
  layers: Layers,

  // действия
  edit: Pencil,
  delete: Trash2,
  save: Save,
  copy: Copy,
  reply: Reply,
  link: Link,
  externalLink: ExternalLink,
  refresh: RefreshCw,
  reset: RotateCcw,
  login: LogIn,
  check: Check,
  checkDouble: CheckCheck,
  flag: Flag,

  // состояние и статус
  loading: RefreshCw,
  info: Info,
  warning: TriangleAlert,
  error: CircleAlert,
  lock: Lock,
  clock: Clock,
  calendar: Calendar,

  // контент
  movie: Film,
  series: Tv,
  star: Star,
  heart: Heart,
  eye: Eye,
  eyeOff: EyeOff,
  note: StickyNote,
  quote: Quote,
  random: Dices,
  user: User,
  bell: Bell,
  bellOff: BellOff,
  thumbsUp: ThumbsUp,
  thumbsDown: ThumbsDown,

  // файлы и обмен
  share: Share2,
  download: Download,
  upload: Upload,
  folder: Folder,
  waiting: Hourglass,
  clearAll: Eraser,
  palette: Palette,

  // состояния списков в плеере (заливка = «включено», см. проп filled)
  completed: CircleCheck,
  abandoned: Ban,
  lightMode: Sun,
  darkMode: Moon,
  expand: Maximize,
  collapse: Minimize,

  // плеер и прочее
  pip: PictureInPicture2,
  screen: Monitor,
  terminal: Terminal,
  language: Languages,
  globe: Globe,
  fingerprint: Fingerprint,
  effects: Sparkles,
  unplug: Unplug
}

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 18 },
  strokeWidth: { type: [Number, String], default: 2 },
  // В Material Icons состояние показывали парой иконок: favorite /
  // favorite_border, visibility / visibility_off и т.д. В Lucide все иконки
  // контурные, поэтому «включено» показываем заливкой той же иконки —
  // так состояние читается, а рисунок не прыгает.
  filled: { type: Boolean, default: false }
})

const resolved = computed(() => {
  const icon = ICONS[props.name]
  if (!icon && import.meta.env.DEV) {
    console.warn(`[AppIcon] неизвестная иконка: "${props.name}"`)
  }
  return icon || null
})
</script>

<style scoped>
.app-icon {
  /* Выравнивание по тексту: SVG по умолчанию сидит на базовой линии
     и «подпрыгивает» относительно подписи рядом. */
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}
</style>
