export function initTheme() {
  const themeToggle = document.getElementById('theme-toggle');
  const iconSun = document.getElementById('icon-sun');
  const iconMoon = document.getElementById('icon-moon');

  function setTheme(mode) {
    if (mode === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      iconSun.classList.remove('hidden');
      iconMoon.classList.add('hidden');
    } else {
      document.documentElement.removeAttribute('data-theme');
      iconSun.classList.add('hidden');
      iconMoon.classList.remove('hidden');
    }
    localStorage.setItem('theme', mode);
  }

  const savedTheme = localStorage.getItem('theme') || 'light';
  setTheme(savedTheme);

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'light' : 'dark');
  });

  return { setTheme };
}
