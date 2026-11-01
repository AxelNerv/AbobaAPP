<template>
  <section class="card interface-card">
    <div class="card-head"><h2>Интерфейс</h2></div>
    <div class="theme-heading">Тема</div>
    <div class="theme-options" role="group" aria-label="Тема оформления">
      <button
        v-for="item in THEMES"
        :key="item.id"
        type="button"
        class="theme-option"
        :class="[{ active: theme.theme === item.id }, `theme-option--${item.id}`]"
        :aria-pressed="theme.theme === item.id"
        @click="requestTheme(item.id)"
      >
        <span class="theme-preview" aria-hidden="true">
          <span class="theme-preview-cards">
            <span v-for="card in 3" :key="card" class="theme-preview-card">
              <span class="theme-preview-art"></span>
              <span class="theme-preview-caption"><i></i><i></i></span>
              <SeasonalCardDecor v-if="item.id === 'halloween'" preview />
            </span>
          </span>
        </span>
        <span class="theme-copy"><strong>{{ item.name }}</strong><small>{{ item.description }}</small></span>
        <AppIcon v-if="theme.theme === item.id" name="check" :size="18" class="theme-check" />
      </button>
    </div>
    <p class="theme-hint">Хэллоуин меняет фон, цвета и карточки: летучие мыши, паутина и стекающие капли. Классические настройки сохраняются. Смена темы — после подтверждения перезапуска.</p>
    <p v-if="theme.theme === 'classic'" class="card-text">Цвет обводки кнопок, постеров и подсветки. Меняется сразу.</p>

    <div v-if="theme.theme === 'classic'" class="swatches" role="radiogroup" aria-label="Цвет акцента">
      <button
        v-for="preset in ACCENT_PRESETS"
        :key="preset.id"
        class="swatch"
        :class="{ active: theme.accent === preset.id }"
        role="radio"
        :aria-checked="theme.accent === preset.id"
        :title="preset.name"
        @click="theme.setAccent(preset.id)"
      >
        <span class="swatch-color" :style="{ background: preset.value }"></span>
        <span class="swatch-name">{{ preset.name }}</span>
      </button>

      <label
        class="swatch swatch--custom"
        :class="{ active: theme.accent === 'custom' }"
        title="Свой цвет"
        tabindex="0"
        @keydown.enter.prevent="$refs.picker.click()"
      >
        <span class="swatch-color swatch-color--custom" :style="{ background: theme.customColor }"></span>
        <span class="swatch-name">Свой</span>
        <input
          ref="picker"
          type="color"
          class="picker"
          :value="theme.customColor"
          tabindex="-1"
          @click="theme.setAccent('custom')"
          @input="theme.setCustomColor($event.target.value)"
        />
      </label>
    </div>

    <div v-if="theme.theme === 'classic'" class="bg-row">
      <span class="bg-label">Фон</span>
      <div class="segmented" role="radiogroup" aria-label="Фон">
        <button
          v-for="item in BACKGROUNDS"
          :key="item.id"
          class="segment"
          :class="{ active: theme.background === item.id }"
          role="radio"
          :aria-checked="theme.background === item.id"
          @click="theme.setBackground(item.id)"
        >
          {{ item.name }}
        </button>
      </div>
    </div>
    <ThemeConfirmation v-if="pendingTheme" :name="pendingTheme.name" :desktop="!!desktopApi" :busy="applying" :error="transitionError" @cancel="cancelTheme" @confirm="confirmTheme" />
  </section>
</template>

<script setup>
import { ACCENT_PRESETS, BACKGROUNDS, THEMES, useThemeStore } from '@/store/theme'
import AppIcon from '@/components/icons/AppIcon.vue'
import ThemeConfirmation from './ThemeConfirmation.vue'
import SeasonalCardDecor from './SeasonalCardDecor.vue'
import { ref } from 'vue'
import { applyThemeAndRestart } from '@/utils/themeTransition'

const theme = useThemeStore()
const desktopApi = window.electronAPI
const pendingTheme = ref(null)
const applying = ref(false)
const transitionError = ref('')
const requestTheme = (id) => {
  if (id === theme.theme || applying.value) return
  transitionError.value = ''
  pendingTheme.value = THEMES.find(item => item.id === id)
}
const cancelTheme = () => { if (!applying.value) pendingTheme.value = null }
const confirmTheme = async () => {
  if (applying.value || !pendingTheme.value) return
  applying.value = true
  try {
    await applyThemeAndRestart(theme, pendingTheme.value.id, desktopApi, () => window.location.reload())
    pendingTheme.value = null
  } catch (error) {
    transitionError.value = error?.message || 'Не удалось применить тему.'
  } finally { applying.value = false }
}
</script>

<style scoped>
.theme-heading { margin: 20px 0 10px; font-size: 13px; color: var(--text-secondary); }
.theme-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.theme-option { position: relative; padding: 8px; min-width: 0; border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg-card); color: var(--text-color); text-align: left; cursor: pointer; transition: border-color 180ms, background-color 180ms; }
.theme-option:hover { border-color: var(--border-hover); }
.theme-option.active { border-color: var(--accent-color); background: rgba(var(--accent-rgb), .06); }
.theme-option:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 3px; }
.theme-preview { position: relative; display: flex; align-items: end; height: 100px; padding: 12px 14px 18px; border-radius: 7px; background: radial-gradient(ellipse at top, #281538, #080d19); }
.theme-option--halloween .theme-preview { background: linear-gradient(#140c1466, #140c1466), url('@/assets/halloween-night.webp') center / cover; }
.theme-preview-cards { display: flex; gap: 10px; }
.theme-preview-card { position: relative; display: block; width: 39px; height: 60px; border-radius: 4px; border: 1px solid #ffffff30; background: #131321; }
.theme-preview-art { display: block; height: 42px; border-radius: 3px 3px 0 0; background: linear-gradient(155deg, transparent 40%, #191b2c 41% 60%, transparent 61%), radial-gradient(circle at 70% 28%, #b9b0c6 0 9%, transparent 10%), linear-gradient(145deg, #5e5874, #28273d); }
.theme-preview-card:nth-child(2) .theme-preview-art { filter: hue-rotate(30deg); }
.theme-preview-card:nth-child(3) .theme-preview-art { filter: hue-rotate(-35deg); }
.theme-preview-caption { display: grid; gap: 3px; padding: 5px; }
.theme-preview-caption i { width: 90%; height: 2px; background: #c4bccb77; border-radius: 2px; }
.theme-preview-caption i + i { width: 45%; opacity: .5; }
.theme-option--halloween .theme-preview-card { border-color: #ad73596e; background: #21151e; }
.theme-option--halloween .theme-preview-art { background: linear-gradient(155deg, transparent 40%, #2c1c2e 41% 60%, transparent 61%), radial-gradient(circle at 70% 28%, #d6ab77 0 9%, transparent 10%), linear-gradient(145deg, #715065, #302437); }
.theme-copy { display: grid; gap: 5px; padding: 12px 24px 6px 4px; }
.theme-copy strong { font-size: 14px; font-weight: 600; }
.theme-copy small { color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.theme-check { position: absolute; right: 12px; bottom: 33px; color: var(--accent-color); }
.theme-hint { margin: 12px 0 20px; color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
@media (max-width: 400px) { .theme-options { grid-template-columns: 1fr; } }
.card {
  min-width: 0;
  background: rgba(15, 20, 32, 0.72);
  border: 1px solid rgba(var(--accent-rgb), 0.1);
  border-radius: 14px;
  padding: 20px 22px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.25);
}
.card-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
}
.card-text {
  margin: 8px 0 16px;
  font-size: 13px;
  color: var(--text-secondary);
}

.swatches {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}
.swatch {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 6px 10px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.swatch:hover {
  border-color: rgba(255, 255, 255, 0.18);
}
.swatch.active {
  border-color: var(--accent-color);
  background: rgba(var(--accent-rgb), 0.08);
  color: #fff;
}
.swatch-color {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.06);
}
.swatch-color--custom {
  outline: 2px dashed rgba(255, 255, 255, 0.35);
  outline-offset: 3px;
}
.swatch-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
/* Сам выбор цвета — системное окно; поле невидимо, кликается вся плитка */
.picker {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  border: 0;
  padding: 0;
}

.bg-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 16px;
  flex-wrap: wrap;
}
.bg-label {
  font-size: 13px;
  color: var(--text-secondary);
}
.segmented {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
}
.segment {
  padding: 7px 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}
.segment.active {
  background: rgba(var(--accent-rgb), 0.16);
  color: var(--accent-color);
}

@media (max-width: 520px) {
  .swatches { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
