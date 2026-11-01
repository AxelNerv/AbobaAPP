<template>
  <span class="seasonal-card-decor" :class="{ 'seasonal-card-decor--preview': preview }" aria-hidden="true">
    <span class="seasonal-card-top"></span>
    <span class="card-corner-web card-corner-web--left"></span>
    <span class="card-corner-web card-corner-web--right"></span>
    <span class="card-blood-edge"></span>
    <span class="card-blood-track">
      <svg v-for="spot in 2" :key="spot" class="card-blood-spout" :class="`card-blood-spout--${spot}`" viewBox="0 0 20 50" fill="currentColor">
        <path class="card-blood-neck" d="M7 0C9 4 7 7 8 13h4c1-6-1-9 1-13Z" />
        <path class="card-blood-drop" d="M10 7C9 10 5.5 13.5 5.5 17a4.5 4.5 0 0 0 9 0C14.5 13.5 11 10 10 7Z" />
      </svg>
    </span>
  </span>
</template>

<script setup>
defineProps({ preview: Boolean })
</script>

<style scoped>
.seasonal-card-decor {
  --drop-fall: 23px;
  --blood-cycle: 5.6s;
  display: none;
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  border-radius: inherit;
}
:global(html[data-theme='halloween'] .seasonal-card-decor),
.seasonal-card-decor--preview { display: block; }
.seasonal-card-top {
  position: absolute; top: -13px; right: -5px; width: calc(100% + 10px); height: 52px;
  background:
    url('@/assets/halloween-bat.svg') left top / 31px 18px no-repeat,
    url('@/assets/halloween-bat.svg') right top / 26px 15px no-repeat;
  opacity: .74;
}
.card-corner-web {
  position: absolute; top: 0; right: 0;
  width: min(28%, 52px); aspect-ratio: 80 / 70;
  background: url('@/assets/halloween-card-web.svg') top right / contain no-repeat;
  opacity: 0;
  transform-origin: top center;
  transform: scaleX(var(--web-mirror, 1)) scale(.4);
  transition: opacity 420ms ease, transform 520ms cubic-bezier(.2, .7, .2, 1);
}
.card-corner-web--left { --web-mirror: -1; left: 0; right: auto; }
/* Separate from the bats: only the two bounded corner patches unfold. */
:global(.lib-card:hover .card-corner-web), :global(.lib-card:focus-within .card-corner-web),
:global(.movie-card:hover .card-corner-web), :global(.movie-card:focus-within .card-corner-web),
:global(.movie-card.active .card-corner-web),
.seasonal-card-decor--preview .card-corner-web {
  opacity: .92;
  transform: scaleX(var(--web-mirror, 1)) scale(1);
}
.card-blood-edge {
  position: absolute; left: 3px; right: 3px; bottom: -13px; height: 16px;
  background: url('@/assets/halloween-blood-edge.svg') center / 100% 100% no-repeat;
  opacity: .92;
}
.card-blood-track { position: absolute; left: 3px; right: 3px; bottom: 3px; height: 0; }
.card-blood-spout { position: absolute; top: 0; width: 16px; height: 40px; overflow: visible; color: #84384a; transform: translateX(-50%); }
/* Fixed outlets in the existing border: fluid gathers here, never sideways. */
.card-blood-spout--1 { left: 40.5%; }
.card-blood-spout--2 { left: 68.25%; --blood-cycle: 6.8s; }
.card-blood-drop, .card-blood-neck { opacity: 0; transform-box: fill-box; transform-origin: top center; }
:global(.lib-card:hover .card-blood-drop), :global(.lib-card:focus-within .card-blood-drop),
:global(.movie-card:hover .card-blood-drop), :global(.movie-card:focus-within .card-blood-drop),
:global(.theme-option:hover .card-blood-drop), :global(.theme-option:focus-visible .card-blood-drop) { animation: blood-fall var(--blood-cycle) linear infinite; }
:global(.lib-card:hover .card-blood-neck), :global(.lib-card:focus-within .card-blood-neck),
:global(.movie-card:hover .card-blood-neck), :global(.movie-card:focus-within .card-blood-neck),
:global(.theme-option:hover .card-blood-neck), :global(.theme-option:focus-visible .card-blood-neck) { animation: blood-neck var(--blood-cycle) linear infinite; }
.seasonal-card-decor--preview {
  --drop-fall: 10px;
}
.seasonal-card-decor--preview .seasonal-card-top {
  top: -6px; right: -2px; width: calc(100% + 4px); height: 24px;
  background-size: 14px 8px, 12px 7px;
  background-position: left top, right top;
}
.seasonal-card-decor--preview .card-corner-web { width: 17px; }
.seasonal-card-decor--preview .card-blood-edge { left: 1px; right: 1px; bottom: -5px; height: 7px; }
.seasonal-card-decor--preview .card-blood-track { left: 1px; right: 1px; bottom: 1px; }
.seasonal-card-decor--preview .card-blood-spout { width: 7px; height: 17.5px; }
@keyframes blood-fall {
  0%, 5% { opacity: 0; transform: translateY(-3px) scale(.3); }
  18% { opacity: 1; transform: translateY(-2px) scale(.65); }
  48% { opacity: 1; transform: translateY(0) scale(1); }
  60% { opacity: 1; transform: translateY(3px) scale(.85, 1.3); }
  68% { opacity: 1; transform: translateY(8px) scale(.85, 1.15); }
  82% { opacity: .8; transform: translateY(var(--drop-fall)) scale(.8, 1.05); }
  88%, 100% { opacity: 0; transform: translateY(var(--drop-fall)) scale(.65); }
}
@keyframes blood-neck {
  0%, 5% { opacity: 0; transform: scaleY(.25); }
  18% { opacity: 1; transform: scaleY(.7); }
  48% { opacity: 1; transform: scaleY(1); }
  60% { opacity: 1; transform: scaleY(1.45); }
  66%, 100% { opacity: 0; transform: scaleY(.15); }
}
@media (prefers-reduced-motion: reduce) {
  .card-corner-web { transition: none; }
  .card-blood-drop, .card-blood-neck { animation: none !important; }
  .card-blood-drop { opacity: 0; }
}
</style>
