<template>
  <section class="card interface-card">
    <div class="card-head"><h2>Интерфейс</h2></div>
    <p class="card-text">Цвет обводки кнопок, постеров и подсветки. Меняется сразу.</p>

    <div class="swatches" role="radiogroup" aria-label="Цвет акцента">
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

    <div class="bg-row">
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
  </section>
</template>

<script setup>
import { ACCENT_PRESETS, BACKGROUNDS, useThemeStore } from '@/store/theme'

const theme = useThemeStore()
</script>

<style scoped>
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
