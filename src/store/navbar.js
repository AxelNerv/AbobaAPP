import { defineStore } from 'pinia'

export const useNavbarStore = defineStore('navbar', {
  state: () => ({
    isNavbarVisible: false,
    isModalSearchVisible: false,
    isModalIdSearchVisible: false,
    isSettingsModalVisible: false,
    headerContent: null
  }),
  actions: {
    toggleNavbar() {
      this.isNavbarVisible = !this.isNavbarVisible
    },
    closeNavbar() {
      this.isNavbarVisible = false
    },
    openNavbar() {
      this.isNavbarVisible = true
    },
    toggleSearchModal() {
      this.isModalSearchVisible = !this.isModalSearchVisible
    },
    openSearchModal() {
      this.isModalSearchVisible = true
      this.isNavbarVisible = false
    },
    closeSearchModal() {
      this.isModalSearchVisible = false
    },
    openIdSearchModal() {
      this.isModalIdSearchVisible = true
      this.isNavbarVisible = false
    },
    closeIdSearchModal() {
      this.isModalIdSearchVisible = false
    },
    openSettingsModal() {
      this.isSettingsModalVisible = true
      this.isNavbarVisible = false
    },
    closeSettingsModal() {
      this.isSettingsModalVisible = false
    },
    setHeaderContent(content) {
      this.headerContent = content
    },
    clearHeaderContent() {
      this.headerContent = null
    }
  }
})
