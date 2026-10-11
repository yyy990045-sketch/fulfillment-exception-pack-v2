import { useEffect, useRef, useState } from 'react';
import { Crosshair, Layers3, Minus, Pause, Play, Plus, RotateCcw, ScanLine } from 'lucide-react';
import { twinVehicles } from '../twin-fixtures';
import type { TwinLayer, TwinSceneController } from '../twin-types';

export function TwinMap({ layer, running, speed, onPick }: { layer: TwinLayer; running: boolean; speed: number; onPick: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<TwinSceneController | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [top, setTop] = useState(false);
  // 场景是异步创建的，创建完成后要把当前交互状态回灌进去，
  // 否则在场景加载完成前点的暂停/速度/图层都会被丢掉，界面与场景不一致。
  const latest = useRef({ layer, running, speed });
  latest.current = { layer, running, speed };

  useEffect(() => {
    let cancelled = false;
    setError('');
    setReady(false);
    import('./create-twin-scene').then(({ createTwinScene }) => {
      if (cancelled || !host.current) return;
      try {
        const controller = createTwinScene(host.current, {
          vehicles: twinVehicles,
          layer: latest.current.layer,
          running: latest.current.running,
          speed: latest.current.speed,
          onPick,
          onError: setError,
        });
        scene.current = controller;
        controller.setLayer(latest.current.layer);
        controller.update({ running: latest.current.running, speed: latest.current.speed });
      } catch {
        setError('仓库场景暂时无法显示，请重试。');
      }
    }).catch(() => setError('仓库场景暂时无法显示，请重试。'));
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, [attempt]);

  // 场景创建之后的日常同步：暂停/速度/图层变化都要传到场景里
  useEffect(() => { scene.current?.setLayer(layer); }, [layer]);
  useEffect(() => { scene.current?.update({ running, speed }); }, [running, speed]);

  // 只有画布真正画出第一帧后才算就绪，避免首屏停在纯黑画面上
  useEffect(() => {
    if (error) return;
    const timer = window.setInterval(() => {
      if (host.current?.querySelector('canvas')?.dataset.ready === 'true') {
        setReady(true);
        window.clearInterval(timer);
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [attempt, error]);

  return <div className="twin-map" data-testid="twin-map">
    <div ref={host} className="twin-map-canvas" />
    {!ready && !error && <div className="twin-map-loading" role="status"><span className="twin-map-spinner" aria-hidden="true" />正在载入仓库运行场景…</div>}
    {error && <div className="twin-map-error" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>重新加载场景</button></div>}
    <div className="twin-map-tools">
      <button type="button" aria-label="复位镜头" title="复位镜头" onClick={() => scene.current?.reset()}><Crosshair size={16} /></button>
      <button type="button" aria-label="放大场景" title="放大场景" onClick={() => scene.current?.zoom(.82)}><Plus size={16} /></button>
      <button type="button" aria-label="缩小场景" title="缩小场景" onClick={() => scene.current?.zoom(1.22)}><Minus size={16} /></button>
      <button type="button" aria-label="切换俯视" title="切换俯视" onClick={() => setTop(scene.current?.toggleTop() ?? false)}><ScanLine size={16} /></button>
      <button type="button" aria-label={running ? '暂停仿真' : '继续仿真'} title={running ? '暂停仿真' : '继续仿真'} onClick={() => window.dispatchEvent(new CustomEvent('twin-toggle-running'))}>{running ? <Pause size={16} /> : <Play size={16} />}</button>
      <button type="button" aria-label="重置场景" title="重置场景" onClick={() => scene.current?.reset()}><RotateCcw size={16} /></button>
    </div>
    <div className="twin-map-caption"><span><i className="is-live" />仓库运行中</span><span>{top ? '俯视' : '立体'}场景</span></div>
    <div className="twin-layer-chip"><Layers3 size={14} /> {layer === '3d' ? '立体视图' : layer === 'plan' ? '平面图' : layer === 'traffic' ? '运输线路' : '异常区域'}</div>
  </div>;
}
