import { useState, useEffect } from 'react';
import {
  Camera, Navigation, Plane, Radar, Radio, Waves, RefreshCw,
  Sliders, CheckCircle, AlertTriangle, X, Shield, Activity,
  Settings
} from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LoadingState } from '../components/ui/StateComponents';
import { getCameraStatusColor, getDeviceStatusColor, formatRelativeTime } from '../lib/utils';
import { monitoringApi, devicesApi } from '../lib/api';
import type { Camera as CameraType, CameraStatus, DeviceType, DeviceStatus } from '../types';

interface StoredFleetDevice {
  id: string;
  name: string;
  type: DeviceType;
  status: DeviceStatus;
  location: string;
  lat: number;
  lng: number;
  lastHeartbeat: string;
  uptimePercent: number;
  batteryLevel?: number;
  signalStrength?: number;
  firmware?: string;
  ip?: string;
}

const DEVICE_ICONS: Record<DeviceType, any> = {
  CAMERA: Camera,
  DRONE: Plane,
  GPS: Navigation,
  AIS: Radio,
  RADAR: Radar,
  SENSOR: Waves,
};

// Sensors & Fleet page: camera health grid + telemetry device table with
// per-item configuration modals that push status changes to the server.
export default function Sensors() {
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [devices, setDevices] = useState<StoredFleetDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Selected item for configuration modal
  const [selectedCamera, setSelectedCamera] = useState<CameraType | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<StoredFleetDevice | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Load cameras + devices in parallel; a single failed endpoint doesn't blank the page.
  const loadSensorData = async () => {
    try {
      const [camRes, devRes] = await Promise.allSettled([
        monitoringApi.cameras(),
        devicesApi.list(),
      ]);

      if (camRes.status === 'fulfilled' && camRes.value.cameras) {
        setCameras(camRes.value.cameras);
      }
      if (devRes.status === 'fulfilled' && devRes.value.devices) {
        setDevices(devRes.value.devices);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to load sensor array.' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadSensorData();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadSensorData();
  };

  const handleUpdateCameraStatus = async (status: CameraStatus) => {
    if (!selectedCamera) return;
    setSavingConfig(true);
    try {
      const updated = await monitoringApi.updateCamera(selectedCamera.id, { status } as any);
      setCameras(curr => curr.map(c => c.id === updated.id ? updated : c));
      setSelectedCamera(updated);
      setFeedback({ type: 'success', message: `${updated.name} status updated to ${status}.` });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to update camera status.' });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleUpdateDeviceStatus = async (status: DeviceStatus) => {
    if (!selectedDevice) return;
    setSavingConfig(true);
    try {
      const updated = await devicesApi.update(selectedDevice.id, { status });
      setDevices(curr => curr.map(d => d.id === updated.id ? updated : d));
      setSelectedDevice(updated);
      setFeedback({ type: 'success', message: `${updated.name} status updated to ${status}.` });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to update device status.' });
    } finally {
      setSavingConfig(false);
    }
  };

  // Count of cameras in an actively-streaming or ready state.
  const onlineCameras = cameras.filter(c => c.status === 'STREAMING' || c.status === 'ONLINE').length;
  const onlineDevices = devices.filter(d => d.status === 'ONLINE').length;

  if (loading && cameras.length === 0 && devices.length === 0) {
    return <LoadingState message="Connecting to surveillance sensor mesh..." size="lg" className="p-12" />;
  }

  return (
    <div className="p-3 space-y-6 sm:p-6 max-w-7xl mx-auto">
      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`flex items-center justify-between p-3 rounded-lg border text-xs font-mono ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="opacity-60 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { l: 'Optical Stream Fleet', v: `${onlineCameras}/${cameras.length}`, c: '#00d4ff', sub: 'Coastal array' },
          { l: 'Telemetry Nodes', v: `${onlineDevices}/${devices.length}`, c: '#00ff88', sub: 'UAV, GPS, Radar, AIS' },
          { l: 'Coverage Sectors', v: '7 Sectors', c: '#ffaa00', sub: 'Arabian Sea & Bengal' },
          { l: 'Mesh Health', v: onlineCameras >= 12 ? 'NOMINAL' : 'DEGRADED', c: onlineCameras >= 12 ? '#00ff88' : '#ffaa00', sub: 'Real-time telemetry' },
        ].map(s => (
          <Card key={s.l} className="py-3 px-4">
            <p className="text-xs text-[var(--ocean-text-dim)] mb-1">{s.l}</p>
            <p className="text-xl sm:text-2xl font-bold font-mono" style={{ color: s.c }}>{s.v}</p>
            <p className="text-[10px] text-[var(--ocean-text-muted)] mt-1">{s.sub}</p>
          </Card>
        ))}
      </div>

      {/* Camera Grid */}
      <Card noPad>
        <div className="flex items-center justify-between px-4 pt-4 mb-2">
          <CardHeader
            title="Coastal Optical Sensor Network"
            subtitle={`${onlineCameras}/${cameras.length} cameras actively streaming high-res feeds`}
            icon={<Camera className="w-4 h-4 text-cyan-400" />}
            className="mb-0"
          />
          <div className="flex items-center gap-2">
            <Badge variant={onlineCameras >= 12 ? 'green' : 'amber'} size="xs">
              {onlineCameras}/{cameras.length} ONLINE
            </Badge>
            <Button
              variant="ghost"
              size="xs"
              icon={<RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />}
              onClick={handleRefresh}
              title="Refresh Camera Telemetry"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 p-4">
          {cameras.map(cam => (
            <div
              key={cam.id}
              onClick={() => setSelectedCamera(cam)}
              className={`p-3 rounded-lg border transition-all cursor-pointer hover:border-cyan-500/60 hover:shadow-lg ${
                cam.status === 'DISCONNECTED' || cam.status === 'ERROR'
                  ? 'border-red-500/30 bg-red-500/5'
                  : cam.status === 'LOW_FPS' || cam.status === 'CONNECTING'
                    ? 'border-amber-500/30 bg-amber-500/5'
                    : 'border-[var(--ocean-border)] bg-[var(--ocean-surface)]'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono text-cyan-400 font-semibold">{cam.id}</span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    cam.status === 'STREAMING'
                      ? 'bg-emerald-400 pulse-dot'
                      : cam.status === 'ONLINE'
                      ? 'bg-cyan-400'
                      : cam.status === 'LOW_FPS' || cam.status === 'CONNECTING'
                      ? 'bg-amber-400 pulse-dot'
                      : 'bg-rose-400'
                  }`}
                />
              </div>
              <p className="text-xs font-semibold text-[var(--ocean-text)] truncate leading-tight">{cam.name}</p>
              <p className="text-[10px] text-[var(--ocean-text-dim)] truncate mt-0.5">{cam.location}</p>
              <p className={`text-[10px] font-mono mt-1.5 ${getCameraStatusColor(cam.status)}`}>{cam.status}</p>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--ocean-border)]/50 text-[10px] text-[var(--ocean-text-muted)] font-mono">
                <span>{cam.fps > 0 ? `${cam.fps} fps` : '—'}</span>
                <span>{cam.resolution}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Sensor & Telemetry Fleet */}
      <Card noPad>
        <div className="px-4 pt-4 flex items-center justify-between">
          <CardHeader
            title="Telemetry Nodes & Fleet Sensor Mesh"
            subtitle="Autonomous UAVs, AIS Coastal Receivers, GPS Reference Beacons, and Radar Arrays"
            icon={<Shield className="w-4 h-4 text-cyan-400" />}
            className="mb-0"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--ocean-border)]">
                {['Device Node', 'Type', 'Status', 'Signal', 'Power / Battery', 'Uptime', 'Last Contact', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-[var(--ocean-text-muted)] uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {devices.map(d => {
                const DeviceIcon = DEVICE_ICONS[d.type] || Activity;
                return (
                  <tr
                    key={d.id}
                    onClick={() => setSelectedDevice(d)}
                    className="border-b border-[var(--ocean-border)]/50 hover:bg-[var(--ocean-card-hover)] transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-[var(--ocean-bg)] border border-[var(--ocean-border)] flex items-center justify-center flex-shrink-0">
                          <DeviceIcon className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[var(--ocean-text)]">{d.name}</p>
                          <p className="text-[10px] text-[var(--ocean-text-muted)]">{d.id} · {d.location}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" size="xs">{d.type}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-mono font-semibold ${getDeviceStatusColor(d.status)}`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-[var(--ocean-border)] overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${d.signalStrength ?? 0}%`,
                              background: (d.signalStrength ?? 0) > 70 ? '#00ff88' : (d.signalStrength ?? 0) > 40 ? '#ffaa00' : '#ff4455',
                            }}
                          />
                        </div>
                        <span className="text-[10px] text-[var(--ocean-text-dim)] font-mono">
                          {d.signalStrength !== undefined ? `${d.signalStrength}%` : '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {d.batteryLevel !== undefined ? (
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1.5 rounded-full bg-[var(--ocean-border)] overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${d.batteryLevel}%`,
                                background: d.batteryLevel > 50 ? '#00ff88' : d.batteryLevel > 20 ? '#ffaa00' : '#ff4455',
                              }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-[var(--ocean-text-dim)]">{d.batteryLevel}%</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-[var(--ocean-text-muted)]">Grid / Solar</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-[var(--ocean-text-dim)]">
                      {d.uptimePercent ? `${d.uptimePercent}%` : '99.2%'}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--ocean-text-dim)]">
                      {formatRelativeTime(d.lastHeartbeat)}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="xs"
                        icon={<Settings className="w-3 h-3" />}
                        onClick={() => setSelectedDevice(d)}
                      >
                        Config
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ─── MODAL: CAMERA CONFIGURATION ──────────────────────────────────── */}
      {selectedCamera && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--ocean-card)] border border-[var(--ocean-border)] rounded-xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-[var(--ocean-border)]">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-[var(--ocean-text)]">{selectedCamera.name}</h3>
                <span className="text-xs font-mono text-cyan-400">({selectedCamera.id})</span>
              </div>
              <button onClick={() => setSelectedCamera(null)} className="text-[var(--ocean-text-muted)] hover:text-[var(--ocean-text)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-[var(--ocean-surface)] border border-[var(--ocean-border)]">
                  <p className="text-[10px] text-[var(--ocean-text-muted)] uppercase tracking-wider">Sector Location</p>
                  <p className="text-xs font-semibold text-[var(--ocean-text)] mt-0.5">{selectedCamera.location}</p>
                  <p className="text-[10px] font-mono text-cyan-400 mt-0.5">{selectedCamera.lat}°N, {selectedCamera.lng}°E</p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--ocean-surface)] border border-[var(--ocean-border)]">
                  <p className="text-[10px] text-[var(--ocean-text-muted)] uppercase tracking-wider">Stream Telemetry</p>
                  <p className="text-xs font-semibold text-[var(--ocean-text)] mt-0.5">{selectedCamera.resolution} @ {selectedCamera.fps} FPS</p>
                  <p className="text-[10px] font-mono text-emerald-400 mt-0.5">Uptime: {selectedCamera.uptimePercent}%</p>
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--ocean-text-dim)] mb-2 uppercase tracking-wider">Operational Mode</label>
                <div className="flex flex-wrap gap-2">
                  {(['STREAMING', 'ONLINE', 'LOW_FPS', 'CONNECTING', 'DISCONNECTED'] as CameraStatus[]).map(s => (
                    <button
                      key={s}
                      disabled={savingConfig}
                      onClick={() => handleUpdateCameraStatus(s)}
                      className={`px-3 py-1.5 text-xs font-mono rounded-lg border transition-all ${
                        selectedCamera.status === s
                          ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300 font-bold'
                          : 'border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text-dim)] hover:text-[var(--ocean-text)]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[var(--ocean-surface)] border border-[var(--ocean-border)] text-xs text-[var(--ocean-text-dim)] space-y-1">
                <div className="flex justify-between">
                  <span>Last Heartbeat:</span>
                  <span className="font-mono text-[var(--ocean-text)]">{new Date(selectedCamera.lastHeartbeat).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Assigned Zone ID:</span>
                  <span className="font-mono text-cyan-400">{selectedCamera.zoneId}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--ocean-border)]">
                <Button variant="ghost" size="sm" onClick={() => setSelectedCamera(null)}>
                  Close
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={savingConfig}
                  onClick={() => handleUpdateCameraStatus('STREAMING')}
                >
                  Force Reconnect Stream
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: DEVICE CONFIGURATION ──────────────────────────────────── */}
      {selectedDevice && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[var(--ocean-card)] border border-[var(--ocean-border)] rounded-xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-[var(--ocean-border)]">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-[var(--ocean-text)]">{selectedDevice.name}</h3>
                <span className="text-xs font-mono text-cyan-400">({selectedDevice.id})</span>
              </div>
              <button onClick={() => setSelectedDevice(null)} className="text-[var(--ocean-text-muted)] hover:text-[var(--ocean-text)]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-[var(--ocean-surface)] border border-[var(--ocean-border)]">
                  <p className="text-[10px] text-[var(--ocean-text-muted)] uppercase tracking-wider">Node Hardware</p>
                  <p className="text-xs font-semibold text-[var(--ocean-text)] mt-0.5">{selectedDevice.type} Array</p>
                  <p className="text-[10px] font-mono text-cyan-400 mt-0.5">{selectedDevice.location}</p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--ocean-surface)] border border-[var(--ocean-border)]">
                  <p className="text-[10px] text-[var(--ocean-text-muted)] uppercase tracking-wider">Link Quality</p>
                  <p className="text-xs font-semibold text-[var(--ocean-text)] mt-0.5">
                    Signal: {selectedDevice.signalStrength ?? 'N/A'}% · Battery: {selectedDevice.batteryLevel ? `${selectedDevice.batteryLevel}%` : 'AC'}
                  </p>
                  <p className="text-[10px] font-mono text-emerald-400 mt-0.5">Uptime: {selectedDevice.uptimePercent}%</p>
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--ocean-text-dim)] mb-2 uppercase tracking-wider">Node State</label>
                <div className="flex flex-wrap gap-2">
                  {(['ONLINE', 'STANDBY', 'MAINTENANCE', 'OFFLINE'] as DeviceStatus[]).map(s => (
                    <button
                      key={s}
                      disabled={savingConfig}
                      onClick={() => handleUpdateDeviceStatus(s)}
                      className={`px-3 py-1.5 text-xs font-mono rounded-lg border transition-all ${
                        selectedDevice.status === s
                          ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300 font-bold'
                          : 'border-[var(--ocean-border)] bg-[var(--ocean-surface)] text-[var(--ocean-text-dim)] hover:text-[var(--ocean-text)]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[var(--ocean-surface)] border border-[var(--ocean-border)] text-xs text-[var(--ocean-text-dim)] space-y-1">
                <div className="flex justify-between">
                  <span>GPS Coordinates:</span>
                  <span className="font-mono text-[var(--ocean-text)]">{selectedDevice.lat}°N, {selectedDevice.lng}°E</span>
                </div>
                <div className="flex justify-between">
                  <span>Firmware Revision:</span>
                  <span className="font-mono text-cyan-400">{selectedDevice.firmware || 'OG-SYS-v2.1'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last Reported Ping:</span>
                  <span className="font-mono text-[var(--ocean-text)]">{new Date(selectedDevice.lastHeartbeat).toLocaleString()}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--ocean-border)]">
                <Button variant="ghost" size="sm" onClick={() => setSelectedDevice(null)}>
                  Close
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={savingConfig}
                  onClick={() => handleUpdateDeviceStatus('ONLINE')}
                >
                  Send Keepalive Ping
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
