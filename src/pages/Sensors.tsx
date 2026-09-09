import React from 'react';
import { Camera, Navigation, Plane, Radar, Radio, Waves, type LucideIcon } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader } from '../components/ui/Card';
import { getCameraStatusColor, getDeviceStatusColor, formatRelativeTime } from '../lib/utils';
import type { CameraStatus, DeviceType, DeviceStatus } from '../types';

const CAMERAS = [
  { id: 'CAM-01', name: 'Alpha 1 — Zone 4 N', status: 'STREAMING' as CameraStatus, fps: 29.8, res: '1080p', uptime: '99.8%', lat: 35.1, lng: -158.3, lastHb: new Date(Date.now() - 5000).toISOString() },
  { id: 'CAM-02', name: 'Beta 2 — Pacific Gyre', status: 'STREAMING' as CameraStatus, fps: 30.0, res: '4K', uptime: '100%', lat: 28.5, lng: -140.2, lastHb: new Date(Date.now() - 3000).toISOString() },
  { id: 'CAM-03', name: 'Beta 3 — Central', status: 'STREAMING' as CameraStatus, fps: 28.9, res: '1080p', uptime: '99.5%', lat: 5.8, lng: -110.2, lastHb: new Date(Date.now() - 8000).toISOString() },
  { id: 'CAM-04', name: 'Alpha 4 — Zone 4 S', status: 'STREAMING' as CameraStatus, fps: 28.3, res: '1080p', uptime: '99.1%', lat: 35.1, lng: -148.4, lastHb: new Date(Date.now() - 4000).toISOString() },
  { id: 'CAM-05', name: 'Delta 5 — Zone 2', status: 'STREAMING' as CameraStatus, fps: 30.0, res: '4K', uptime: '98.9%', lat: 19.8, lng: -157.4, lastHb: new Date(Date.now() - 6000).toISOString() },
  { id: 'CAM-06', name: 'Zeta 6 — Oregon', status: 'STREAMING' as CameraStatus, fps: 29.1, res: '1080p', uptime: '99.7%', lat: 42.1, lng: -130.5, lastHb: new Date(Date.now() - 7000).toISOString() },
  { id: 'CAM-07', name: 'Eta 7 — Eastern', status: 'ONLINE' as CameraStatus, fps: 25.4, res: '720p', uptime: '97.2%', lat: -10.2, lng: -85.4, lastHb: new Date(Date.now() - 15000).toISOString() },
  { id: 'CAM-08', name: 'Gamma 8 — Coastal', status: 'LOW_FPS' as CameraStatus, fps: 12.1, res: '1080p', uptime: '92.4%', lat: 20.4, lng: 145.6, lastHb: new Date(Date.now() - 25000).toISOString() },
  { id: 'CAM-09', name: 'Eta 9 — Zone 5', status: 'STREAMING' as CameraStatus, fps: 29.6, res: '1080p', uptime: '99.3%', lat: -10.2, lng: -95.4, lastHb: new Date(Date.now() - 5000).toISOString() },
  { id: 'CAM-10', name: 'Theta 10 — N Pacific', status: 'STREAMING' as CameraStatus, fps: 30.0, res: '4K', uptime: '99.9%', lat: 14.2, lng: -155.8, lastHb: new Date(Date.now() - 2000).toISOString() },
  { id: 'CAM-11', name: 'Iota 11 — Sector A', status: 'STREAMING' as CameraStatus, fps: 28.7, res: '1080p', uptime: '99.6%', lat: 20.0, lng: -145.0, lastHb: new Date(Date.now() - 9000).toISOString() },
  { id: 'CAM-12', name: 'Kappa 12 — Zone 1', status: 'STREAMING' as CameraStatus, fps: 29.2, res: '1080p', uptime: '99.4%', lat: 22.0, lng: -152.0, lastHb: new Date(Date.now() - 11000).toISOString() },
  { id: 'CAM-13', name: 'Lambda 13 — Pacific', status: 'CONNECTING' as CameraStatus, fps: 0, res: '4K', uptime: '95.1%', lat: 30.0, lng: -162.0, lastHb: new Date(Date.now() - 60000).toISOString() },
  { id: 'CAM-14', name: 'Mu 14 — Coastal E', status: 'STREAMING' as CameraStatus, fps: 29.9, res: '1080p', uptime: '99.8%', lat: 38.0, lng: -128.0, lastHb: new Date(Date.now() - 4000).toISOString() },
  { id: 'CAM-15', name: 'Delta 15 — Sector B', status: 'DISCONNECTED' as CameraStatus, fps: 0, res: '720p', uptime: '88.2%', lat: 24.0, lng: -138.0, lastHb: new Date(Date.now() - 12 * 60000).toISOString() },
];

const DEVICES = [
  { id: 'DRN-01', name: 'UAV Alpha', type: 'DRONE' as DeviceType, status: 'ONLINE' as DeviceStatus, location: 'Zone 4', battery: 78, signal: 95, uptime: '99.1%', lastHb: new Date(Date.now() - 8000).toISOString() },
  { id: 'GPS-01', name: 'GPS Array 1', type: 'GPS' as DeviceType, status: 'ONLINE' as DeviceStatus, location: 'Central', battery: undefined, signal: 100, uptime: '100%', lastHb: new Date(Date.now() - 2000).toISOString() },
  { id: 'AIS-01', name: 'AIS Receiver', type: 'AIS' as DeviceType, status: 'ONLINE' as DeviceStatus, location: 'Command', battery: undefined, signal: 88, uptime: '99.7%', lastHb: new Date(Date.now() - 5000).toISOString() },
  { id: 'RAD-01', name: 'Radar Node 1', type: 'RADAR' as DeviceType, status: 'MAINTENANCE' as DeviceStatus, location: 'Zone 2', battery: undefined, signal: 0, uptime: '72.4%', lastHb: new Date(Date.now() - 3600000).toISOString() },
  { id: 'DRN-02', name: 'UAV Beta', type: 'DRONE' as DeviceType, status: 'STANDBY' as DeviceStatus, location: 'Port', battery: 100, signal: 100, uptime: '99.9%', lastHb: new Date(Date.now() - 30000).toISOString() },
  { id: 'SEN-01', name: 'Water Sensor 1', type: 'SENSOR' as DeviceType, status: 'ONLINE' as DeviceStatus, location: 'Zone 1', battery: 62, signal: 82, uptime: '98.4%', lastHb: new Date(Date.now() - 15000).toISOString() },
];

const DEVICE_ICONS: Record<DeviceType, LucideIcon> = {
  CAMERA: Camera,
  DRONE: Plane,
  GPS: Navigation,
  AIS: Radio,
  RADAR: Radar,
  SENSOR: Waves,
};

export default function Sensors() {
  const online = CAMERAS.filter(c => c.status === 'STREAMING' || c.status === 'ONLINE').length;

  return (
    <div className="p-3 space-y-6 sm:p-6">
      {/* Camera grid */}
      <Card noPad>
        <CardHeader
          title="Camera Network"
          subtitle={`${online}/${CAMERAS.length} cameras active`}
          action={<Badge variant={online >= 14 ? 'green' : 'amber'} size="xs">{online}/{CAMERAS.length} ONLINE</Badge>}
          className="px-4 pt-4"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 px-4 pb-4">
          {CAMERAS.map(cam => (
            <div
              key={cam.id}
              className={`p-3 rounded-lg border transition-all ${
                cam.status === 'DISCONNECTED' || cam.status === 'ERROR'
                  ? 'border-red-500/30 bg-red-500/5'
                  : cam.status === 'LOW_FPS' || cam.status === 'CONNECTING'
                    ? 'border-amber-500/30 bg-amber-500/5'
                    : 'border-[var(--ocean-border)] bg-[var(--ocean-surface)]'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono text-[var(--ocean-text-muted)]">{cam.id}</span>
                <span className={`w-2 h-2 rounded-full ${
                  cam.status === 'STREAMING' ? 'bg-green-400 pulse-dot' :
                  cam.status === 'ONLINE' ? 'bg-cyan-400' :
                  cam.status === 'LOW_FPS' ? 'bg-amber-400' :
                  cam.status === 'CONNECTING' ? 'bg-amber-400 pulse-dot' : 'bg-red-400'
                }`} />
              </div>
              <p className="text-xs font-semibold text-[var(--ocean-text)] truncate leading-tight">{cam.name}</p>
              <p className={`text-[10px] font-mono mt-1 ${getCameraStatusColor(cam.status)}`}>{cam.status}</p>
              <div className="flex items-center justify-between mt-2 text-[10px] text-[var(--ocean-text-muted)]">
                <span>{cam.fps > 0 ? `${cam.fps} fps` : 'N/A'}</span>
                <span>{cam.res}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Devices */}
      <Card noPad>
        <CardHeader title="Sensor Fleet" subtitle="Drones, GPS, AIS, Radar" className="px-4 pt-4" />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--ocean-border)]">
                {['Device', 'Type', 'Status', 'Signal', 'Battery', 'Uptime', 'Last Ping'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-[var(--ocean-text-muted)] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DEVICES.map(d => {
                const DeviceIcon = DEVICE_ICONS[d.type];
                return (
                <tr key={d.id} className="border-b border-[var(--ocean-border)]/50 hover:bg-[var(--ocean-card-hover)] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <DeviceIcon className="h-4 w-4 flex-shrink-0 text-[#4cd6fb]" aria-hidden="true" />
                      <div>
                        <p className="text-xs font-semibold text-[var(--ocean-text)]">{d.name}</p>
                        <p className="text-[10px] text-[var(--ocean-text-muted)]">{d.id} · {d.location}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><Badge variant="outline" size="xs">{d.type}</Badge></td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-mono ${getDeviceStatusColor(d.status)}`}>{d.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-[var(--ocean-border)] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${d.signal}%`, background: d.signal > 70 ? '#00ff88' : d.signal > 40 ? '#ffaa00' : '#ff4455' }} />
                      </div>
                      <span className="text-[10px] text-[var(--ocean-text-dim)] font-mono">{d.signal}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {d.battery !== undefined ? (
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1.5 rounded-full bg-[var(--ocean-border)] overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${d.battery}%`, background: d.battery > 50 ? '#00ff88' : d.battery > 20 ? '#ffaa00' : '#ff4455' }} />
                        </div>
                        <span className="text-[10px] font-mono text-[var(--ocean-text-dim)]">{d.battery}%</span>
                      </div>
                    ) : <span className="text-[10px] text-[var(--ocean-text-muted)]">N/A</span>}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-[var(--ocean-text-dim)]">{d.uptime}</td>
                  <td className="px-4 py-3 text-xs text-[var(--ocean-text-dim)]">{formatRelativeTime(d.lastHb)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
