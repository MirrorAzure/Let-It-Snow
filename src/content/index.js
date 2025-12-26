let snowInterval = null;
let creationTimeouts = [];

function stopSnow() {
  if (snowInterval) {
    clearInterval(snowInterval);
    snowInterval = null;
  }
  creationTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
  creationTimeouts = [];
  document.querySelectorAll('span[id^="snowflake-"]').forEach(el => el.remove());
}

function startSnow(config) {
  stopSnow(); 
  const {
    snowmax = 80,
    sinkspeed = 0.4,
    snowminsize = 15,
    snowmaxsize = 40,
    snowcolor = ['#ffffff'],
    snowletters = ['❄']
  } = config;

  const flakes = [];
  const snowsizerange = snowmaxsize - snowminsize;
  let flakeCount = 0;
  
  const groupSize = snowmax / 80; // Размер группы снежинок
  const groupDelay = 1000; // Задержка между группами в миллисекундах

  function createFlakeGroup() {
    for (let i = 0; i < groupSize && flakeCount < snowmax; i++, flakeCount++) {
      const id = `snowflake-${flakeCount}`;
      const flake = document.createElement('span');
      flake.id = id;
      flake.innerHTML = snowletters[Math.floor(Math.random() * snowletters.length)];
      flake.style.position = 'fixed';
      flake.style.pointerEvents = 'none';
      flake.style.userSelect = 'none';
      flake.style.color = snowcolor[Math.floor(Math.random() * snowcolor.length)];
      flake.style.fontSize = (snowminsize + Math.random() * snowsizerange) + 'px';
      flake.style.zIndex = '999999';
      flake.style.left = Math.random() * window.innerWidth + 'px';
      flake.style.top = '-' + snowmaxsize + 'px';
      flake.style.transition = 'none';
      flake.style.textShadow = '0 0 5px rgba(255, 255, 255, 0.7)';
      flake.style.willChange = 'transform, opacity';
      
      if (Math.random() > 0.7) {
        flake.style.animation = `twinkle ${2 + Math.random() * 3}s infinite alternate`;
        const style = document.createElement('style');
        style.textContent = `
          @keyframes twinkle {
            0%, 100% { opacity: 0.7; }
            50% { opacity: 1; }
          }
        `;
        document.head.appendChild(style);
      }

      document.body.appendChild(flake);

      flakes.push({
        el: flake,
        x: parseFloat(flake.style.left),
        y: -snowmaxsize,
        amplitude: Math.random() * 30,
        frequency: 0.03 + Math.random() * 0.07,
        phase: Math.random() * Math.PI * 2,
        sinkSpeed: sinkspeed * (parseFloat(flake.style.fontSize) / 20),
        rotation: 0,
        rotationSpeed: (Math.random() - 0.5) * 0.1
      });
    }
    
    if (!snowInterval && flakes.length) {
      startAnimation();
    }

    if (flakeCount < snowmax) {
      const timeoutId = setTimeout(createFlakeGroup, groupDelay);
      creationTimeouts.push(timeoutId);
    }
  }

  function startAnimation() {
    function animate() {
      flakes.forEach(flake => {
        flake.phase += flake.frequency;
        flake.y += flake.sinkSpeed;
        flake.rotation += flake.rotationSpeed;

        const offsetX = flake.amplitude * Math.sin(flake.phase);
        flake.el.style.left = (flake.x + offsetX) + 'px';
        flake.el.style.top = flake.y + 'px';
        flake.el.style.transform = `rotate(${flake.rotation}rad)`;

        if (flake.y > window.innerHeight) {
          flake.y = -snowmaxsize;
          flake.x = Math.random() * window.innerWidth;
          flake.phase = 0;
          if (Math.random() > 0.8) {
            flake.el.innerHTML = snowletters[Math.floor(Math.random() * snowletters.length)];
            flake.el.style.color = snowcolor[Math.floor(Math.random() * snowcolor.length)];
          }
        }
      });
    }

    snowInterval = setInterval(animate, 50);
  }

  createFlakeGroup();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startSnow') {
    startSnow(message.config);
  } else if (message.action === 'stopSnow') {
    stopSnow();
  }
});

window.addEventListener('beforeunload', stopSnow);
