(() => {
  'use strict';

  // web/live2d -> project root uses ../../../, not ../../../../.
  const root = '../../../assets/live2d-poc/';
  const modelURL = new URL(root + 'models/Hiyori/Hiyori.model3.json', location.href).href;
  const state = window.__poc = {
    loaded: false,
    modelWidth: 0,
    modelHeight: 0,
    params: { angleX: null, angleY: null, mouthOpenY: null, eyeLOpen: null }
  };
  const fail = (message) => window.showPocError(message + '\nURL: ' + modelURL);

  if (!window.PIXI || !PIXI.live2d || !PIXI.live2d.Live2DModel || !window.Live2DCubismCore) {
    fail('依赖未加载：需要依次加载 pixi.min.js → live2dcubismcore.min.js → cubism4.min.js');
    return;
  }

  let app;
  try {
    app = new PIXI.Application({
      resizeTo: window,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true
    });
    document.getElementById('stage').appendChild(app.view);
  } catch (error) {
    fail('透明画布初始化失败：' + String(error));
    return;
  }

  PIXI.live2d.Live2DModel.from(modelURL).then((model) => {
    app.stage.addChild(model);
    model.anchor.set(0.5, 0.5);
    const rawWidth = model.width || (model.internalModel && model.internalModel.width) || 1;
    const rawHeight = model.height || (model.internalModel && model.internalModel.height) || 1;

    function layout() {
      const scale = Math.min(app.screen.width / rawWidth, app.screen.height / rawHeight) * 0.95;
      model.scale.set(scale);
      model.position.set(app.screen.width / 2, app.screen.height / 2);
      state.modelWidth = model.width;
      state.modelHeight = model.height;
    }
    layout();
    window.addEventListener('resize', layout);
    state.loaded = true;

    const onMove = (event) => {
      const rect = app.view.getBoundingClientRect();
      const x = (event.clientX - rect.left) * app.screen.width / rect.width;
      const y = (event.clientY - rect.top) * app.screen.height / rect.height;
      model.focus(x, y);
    };
    window.addEventListener('pointermove', onMove);

    // PIXI's hitTest receives canvas coordinates, not client coordinates.
    app.view.addEventListener('pointerdown', (event) => {
      const rect = app.view.getBoundingClientRect();
      const point = { x: (event.clientX - rect.left) * app.screen.width / rect.width,
        y: (event.clientY - rect.top) * app.screen.height / rect.height };
      if (model.hitTest(point.x, point.y).length) {
        model.motion('TapBody').catch((error) => fail('TapBody 动作失败：' + String(error)));
      }
    });

    // This standalone preview has no speech input; reserve the flag for a future speaking source.
    let speaking = false;
    window.setInterval(() => {
      if (!speaking && !document.hidden) {
        model.motion('Idle').catch((error) => fail('Idle 动作失败：' + String(error)));
      }
    }, 18000);

    const names = { angleX: 'ParamAngleX', angleY: 'ParamAngleY',
      mouthOpenY: 'ParamMouthOpenY', eyeLOpen: 'ParamEyeLOpen' };
    function refresh() {
      const core = model.internalModel && model.internalModel.coreModel;
      if (core) {
        for (const [name, id] of Object.entries(names)) {
          const index = core.getParameterIndex(id);
          state.params[name] = index < core.getParameterCount() ? core.getParameterValueByIndex(index) : null;
        }
      }
      state.modelWidth = model.width;
      state.modelHeight = model.height;
      requestAnimationFrame(refresh);
    }
    requestAnimationFrame(refresh);
  }).catch((error) => fail('Hiyori 模型加载失败：' + String(error)));
})();
