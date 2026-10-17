<template>
  <div class="contact-text">
    <p>
      Если Вы владелец авторских прав, просим Вас учесть, что все плееры на сайте из сторонних API
      источников. Напишите на почту или в Телеграм с подтверждением авторских прав для удаления
      контента с сайта.
    </p>
    <p>
      If you are a copyright owner, please note that all players on the site are from third-party
      API sources. Please write to email or Telegram with confirmation of copyright for the removal
      of content from the site.
    </p>
    <p>
      <a href="mailto:admin@abobatv.ru">admin@abobatv.ru</a> |
      <a href="https://t.me/abobatv_sup" target="_blank" rel="noopener noreferrer"
        >https://t.me/abobatv_sup</a
      >
    </p>
    <h2>Источники данных</h2>
    <p>
      <a href="https://anilist.co/" target="_blank" rel="noopener noreferrer">AniList</a> — данные аниме.
      <a href="https://www.omdbapi.com/" target="_blank" rel="noopener noreferrer">OMDb</a> —
      данные фильмов, CC BY-NC 4.0. TMDB и OMDb используются только после настройки личных API-ключей.
    </p>
    <p>
      <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">
        <img src="@/assets/tmdb-logo.svg" alt="TMDB" width="32" height="23" />
      </a>
      This product uses the TMDB API but is not endorsed or certified by TMDB.
    </p>
    <p>
      Логотип TMDB — Travis Bell, без изменений,
      <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>.
    </p>
  </div>
</template>

<style scoped>
.contact-text {
  color: #ffffff;
  background-color: #333333;
  padding: 20px;
  border-radius: 5px;
  margin: 0 auto;
  max-width: 800px;
  margin-top: 20px;
  line-height: 1.6;
}

.contact-text a {
  color: #5bb8cc;
  text-decoration: none;
}

.contact-text a:hover {
  text-decoration: underline;
}
</style>
