import './style.css';
import { App } from './game/app.js';

function boot() {
  try {
    window.cueClub = new App();
  } catch (err) {
    console.error(err);
    const b = document.getElementById('boot');
    b.classList.remove('gone');
    b.textContent = 'Sorry - this browser could not start WebGL. ' + (err && err.message ? err.message : '');
  }
}
boot();
