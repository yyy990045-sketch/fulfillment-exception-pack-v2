export type TwinLayer = '3d' | 'plan' | 'traffic' | 'heat';
export type TwinStatus = 'moving' | 'idle' | 'alert' | 'charging';
export type TwinVehicle = { id: string; label: string; x: number; z: number; status: TwinStatus; battery: number; task: string; progress: number; color: string };
export type TwinZone = { id: string; label: string; x: number; z: number; width: number; depth: number; tone: 'blue' | 'cyan' | 'amber' | 'red' };
export type TwinSceneOptions = { vehicles: TwinVehicle[]; layer: TwinLayer; running: boolean; speed: number; onPick: (id: string) => void; onError: (message: string) => void };
export type TwinSceneController = { reset: () => void; zoom: (factor: number) => void; toggleTop: () => boolean; setLayer: (layer: TwinLayer) => void; update: (state: { running: boolean; speed: number }) => void; dispose: () => void };
