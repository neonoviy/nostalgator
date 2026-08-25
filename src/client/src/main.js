import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import i18n from './i18n'
import { setI18nInstance } from './i18n/composable.js'
import './styles/main.scss'
import VueTippy from 'vue-tippy'
import 'tippy.js/dist/tippy.css'

// Disable console.log in production (console.error/warn remain)
if (import.meta.env.PROD) {
  console.log = () => {}
}

const app = createApp(App)

app.use(router)
app.use(i18n)

// Make i18n available to composables
setI18nInstance(i18n)

app.use(VueTippy, {
  directive: 'tooltip',
  defaultProps: {
    followCursor: true,
    placement: 'bottom-start',
    delay: [200, 0],
    arrow: false,
    distance: 20,
  },
})

app.mount('#app')
