export const routes = [
  {
    path: '/',
    component: () => import('@/components/MovieSearch.vue'),
    name: 'home',
    meta: {
      title: 'AbobaTV - Поиск фильмов'
    }
  },
  {
    // Страницы топа больше нет: из меню на неё было не попасть, фильтры периода
    // не работали (kinobd не делит топ по периодам). Старые ссылки — на главную.
    path: '/top',
    redirect: '/'
  },
  {
    path: '/movie/:kp_id/:slug?',
    component: () => import('@/components/MovieInfo.vue'),
    name: 'movie-info',
    meta: {
      title: 'AbobaTV - Просмотр фильма'
    }
  },
  {
    path: '/shiki/:shiki_id',
    redirect: '/'
  },
  {
    path: '/library',
    component: () => import('@/components/Library.vue'),
    name: 'library',
    meta: {
      title: 'AbobaTV - Моя библиотека'
    }
  },
  {
    path: '/settings',
    component: () => import('@/components/ShareWifi.vue'),
    name: 'settings',
    meta: {
      title: 'AbobaTV - Настройки'
    }
  },
  // Старый адрес страницы, когда она была только про Wi-Fi.
  { path: '/share', redirect: '/settings' },
  {
    path: '/contact',
    name: 'ContactsPage',
    component: () => import('@/components/ContactsPage.vue'),
    meta: {
      title: 'AbobaTV - Контакты'
    }
  },
  {
    path: '/id-search',
    name: 'IdSearch',
    component: () => import('@/components/MovieSearch.vue'),
    meta: {
      title: 'AbobaTV - Поиск по ID'
    }
  },
  {
    path: '/history',
    name: 'history',
    component: () => import('@/components/HistoryPage.vue'),
    meta: {
      title: 'AbobaTV - История просмотра'
    }
  },
  {
    path: '/favorites',
    name: 'favorites',
    component: () => import('@/components/FavoritesPage.vue'),
    meta: {
      title: 'AbobaTV - Избранное'
    }
  },
  {
    path: '/notifications',
    name: 'notifications',
    component: () => import('@/components/NotificationsPage.vue'),
    meta: {
      title: 'AbobaTV - Уведомления',
      requiresAuth: true
    }
  },
  {
    path: '/:pathMatch(.*)*',
    component: () => import('@/components/NotFound.vue'),
    name: 'NotFound',
    meta: {
      title: '404 - Страница не найдена'
    }
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/components/Login.vue'),
    meta: {
      title: 'AbobaTV - Вход'
    }
  },
  {
    path: '/user',
    redirect: '/library'
  },
  {
    path: '/lists/:user_id?',
    name: 'lists',
    component: () => import('@/components/UserLists.vue'),
    meta: {
      title: 'AbobaTV - Списки'
    }
  },
  {
    path: '/auth-success',
    name: 'auth-success',
    component: () => import('@/components/AuthSuccess.vue'),
    meta: {
      title: 'AbobaTV - Вход'
    }
  }
]
