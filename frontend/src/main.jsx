import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const rawApi = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const API = rawApi
  ? (rawApi.endsWith('/api') ? rawApi : `${rawApi}/api`)
  : (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api');

async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(API + path, {
    ...options,
    headers: {
      ...(!isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
      ...(localStorage.token ? { Authorization: `Bearer ${localStorage.token}` } : {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
  return payload;
}

const formatMoney = (value) => Number(value || 0).toLocaleString('th-TH');
const formatDate = (value) => value ? new Date(value).toLocaleDateString('th-TH') : '-';

const LINE_LOGIN_CLIENT_ID = '2011816169';
function redirectToLine(state = 'login') {
  const redirectUri = window.location.origin;
  const url = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${LINE_LOGIN_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=profile%20openid&bot_prompt=aggressive`;
  window.location.href = url;
}

function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({});
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const result = await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(form) });
      localStorage.token = result.token;
      localStorage.user = JSON.stringify(result.user);
      onLogin(result.user);
      } catch (err) {
        setError(err instanceof TypeError
          ? 'เชื่อมต่อ Backend ไม่ได้ กรุณาตรวจสอบว่าเปิด backend ที่พอร์ต 3000 แล้ว'
          : err.message);
    }
  }

  const update = (name) => (event) => setForm({ ...form, [name]: event.target.value });

  return (
    <main className="login-page">
      <div className="login-brand">
        <div className="brand-mark">P</div>
        <h1>ระบบจอง<br />ที่จอดรถอัจฉริยะ</h1>
        <p>ตรวจสอบช่องจอดแบบเรียลไทม์ จองล่วงหน้า และจัดการอุปกรณ์ IoT ได้จากที่เดียว</p>
      </div>
      <form className="login-card" onSubmit={submit}>
        <p className="eyebrow">SMART PARKING CONTROL</p>
        <h2>{mode === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชีผู้ใช้'}</h2>
        <p className="muted">กรอกข้อมูลเพื่อเข้าสู่ระบบจัดการที่จอดรถ</p>
        {mode === 'register' && <label>ชื่อที่แสดง<input required onChange={update('name')} /></label>}
        <label>ชื่อผู้ใช้หรืออีเมล<input required onChange={update('username')} /></label>
        {mode === 'register' && <label>อีเมล<input type="email" onChange={update('email')} /></label>}
        <label>รหัสผ่าน<input required type="password" onChange={update('password')} /></label>
        {error && <div className="alert error">{error}</div>}
        <button className="button primary full">{mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}</button>
        <div className="line-login-divider"><span>หรือ</span></div>
        <button type="button" className="button line-button full" onClick={() => redirectToLine('login')}>
          <span className="line-icon-badge" style={{ width: 28, height: 28, borderRadius: 6 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff"><path d="M19.365 9.864c0-4.043-4.195-7.324-9.365-7.324s-9.365 3.281-9.365 7.324c0 3.621 3.222 6.657 7.764 7.219.303.066.715.2.818.458.093.235.061.602.03.841l-.133.799c-.04.24-.185.938.822.512 1.007-.426 5.432-3.199 7.411-5.477 1.34-1.442 2.018-2.91 2.018-4.352zm-12.872 1.95h-.898a.382.382 0 0 1-.382-.382v-2.738c0-.211.171-.382.382-.382h.898c.211 0 .382.171.382.382v2.738a.382.382 0 0 1-.382.382zm2.086 0a.382.382 0 0 1-.382-.382v-2.738c0-.211.171-.382.382-.382h.898c.211 0 .382.171.382.382v2.738a.382.382 0 0 1-.382.382h-.898zm4.512 0a.382.382 0 0 1-.382-.382v-1.637l-1.693 2.019h-.441a.382.382 0 0 1-.382-.382v-2.738c0-.211.171-.382.382-.382h.898c.211 0 .382.171.382.382v1.637l1.693-2.019h.441a.382.382 0 0 1 .382.382v2.738a.382.382 0 0 1-.382.382h-.898zm2.67 0a.382.382 0 0 1-.382-.382v-2.738c0-.211.171-.382.382-.382h1.996c.211 0 .382.171.382.382v.457a.382.382 0 0 1-.382.382h-1.098v.481h.898c.211 0 .382.171.382.382v.457a.382.382 0 0 1-.382.382h-.898v.481h1.098c.211 0 .382.171.382.382v.457a.382.382 0 0 1-.382.382h-1.996z"/></svg>
          </span>
          <span>เข้าสู่ระบบด้วย LINE</span>
        </button>
        <button type="button" className="link-button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'ยังไม่มีบัญชี? สมัครสมาชิก' : 'กลับไปเข้าสู่ระบบ'}
        </button>
      </form>
    </main>
  );
}

function Header({ user, onLogout, lastUpdated }) {
  const timeStr = lastUpdated
    ? lastUpdated.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:--:--';
  return <header className="topbar">
    <div className="brand"><div className="brand-mark small">P</div><div><strong>ระบบจองที่จอดรถ</strong><span>SMART PARKING · SUPABASE · ESP32</span></div></div>
    <div className="user-menu">
      <span className="connection-pill"><i />Backend ออนไลน์</span>
      <span className="connection-pill live-pill"><span className="live-dot" />LIVE · {timeStr}</span>
      {user.role !== 'admin' && <span className={`badge credit-pill ${Number(user.credit || 0) > 0 ? 'available' : 'unavailable'}`}>เครดิต ฿{formatMoney(user.credit)}</span>}
      <span className={`badge line-pill ${user.line_user_id ? 'available' : 'unavailable'}`}>LINE {user.line_user_id ? 'เชื่อมต่อแล้ว' : 'ยังไม่เชื่อมต่อ'}</span>
      <span className={`role ${user.role}`}>{user.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้'}</span>
      <span className="avatar">{user.name?.slice(0, 1)}</span>
      <button className="button compact" onClick={onLogout}>ออกจากระบบ</button>
    </div>
  </header>;
}

function Sidebar({ user, view, setView }) {
  const items = user.role === 'admin'
    ? [['dashboard', '▦', 'ภาพรวมการจอง'], ['users', '♙', 'จัดการผู้ใช้'], ['devices', '⌁', 'อุปกรณ์ / ไม้กั้น'], ['layout', '⊞', 'จัดการผังลานจอด']]
    : [['booking', 'P', 'จองที่จอดรถ'], ['control', '⌁', 'ควบคุมช่องจอด'], ['history', '▤', 'ประวัติของฉัน']];
  return <aside className="sidebar">{items.map(([id, icon, label]) =>
    <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => setView(id)}><span>{icon}</span>{label}</button>
  )}</aside>;
}

function PageHead({ title, description }) {
  return <div className="page-head"><h1>{title}</h1><p>{description}</p></div>;
}

function resolveSlotState(slot, devices) {
  if (slot.status === 'unavailable') {
    return { status: 'unavailable', label: 'กำลังซ่อม', canBook: false };
  }
  const sensor = devices?.find((d) => d.type === 'sensor' && d.linked_slot === slot.id);
  const isCarPresent = sensor?.status === 'online' && (sensor?.presence === 'occupied' || sensor?.car_present === true);
  if (slot.status === 'booked' || isCarPresent) {
    return {
      status: 'booked',
      label: isCarPresent && slot.status !== 'booked' ? 'มีรถจอด' : 'ไม่ว่าง',
      canBook: false,
      sensor
    };
  }
  return { status: 'available', label: 'ว่าง', canBook: true, sensor };
}

function StatCards({ slots, devices, bookings, user }) {
  const resolved = slots.map((s) => resolveSlotState(s, devices));
  const stats = [
    ['cyan', resolved.filter((s) => s.canBook).length, 'ช่องว่าง'],
    ['amber', resolved.filter((s) => s.status === 'booked').length, 'ไม่ว่าง / มีรถจอด'],
    ['red', resolved.filter((s) => s.status === 'unavailable').length, 'ไม่พร้อมใช้งาน'],
    ['violet', `฿${formatMoney(20)}`, user?.role === 'admin' ? 'รายการจองทั้งหมด' : 'ราคาต่อชั่วโมง'],
  ];
  return <div className="stats">{stats.map(([color, value, label]) => <div className={`stat ${color}`} key={label}><strong>{user?.role === 'admin' && label === 'รายการจองทั้งหมด' ? bookings.length : value}</strong><span>{label}</span></div>)}</div>;
}

function SlotGrid({ slots, devices, onSelect }) {
  return <div className="parking-lane"><div className="lane-label">↑ ทางเข้า &nbsp;/&nbsp; ทางออก</div><div className="slot-grid">{slots.map((slot) => {
    const { status, label, canBook, sensor } = resolveSlotState(slot, devices);
    return <button type="button" className={`slot-card ${status}`} key={slot.id} disabled={!canBook} onClick={() => onSelect?.(slot)} aria-label={`${slot.code} ${label}`}>
      <span className={`sensor-dot ${sensor?.status === 'online' ? 'online' : 'offline'}`} />
      <strong>{slot.code}</strong>
      <small>{label}</small>
      <em>{slot.type || 'ปกติ'}</em>
    </button>;
  })}</div></div>;
}

function getInitialBookingTime() {
  const future = new Date(Date.now() + 15 * 60000);
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(future);
  const timeStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(future);
  return { date: dateStr, time: timeStr, duration: 1 };
}

function UserBooking({ data, user, notify, setView }) {
  const [floor, setFloor] = useState(1);
  const [selected, setSelected] = useState(null);
  const [booking, setBooking] = useState(getInitialBookingTime);
  const [modalError, setModalError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const slots = data.slots.filter((slot) => slot.floor === floor).sort((a, b) => a.slot_order - b.slot_order);
  const totalAmount = Number(booking.duration || 1) * 20;
  const userCredit = Number(user?.credit || 0);
  const isInsufficient = userCredit < totalAmount;

  const handleSelectSlot = (slot) => {
    setSelected(slot);
    setModalError('');
    setBooking(getInitialBookingTime());
  };

  const book = async (event) => {
    event.preventDefault();
    setModalError('');

    if (isInsufficient) {
      setModalError(`เครดิตของคุณไม่เพียงพอสำหรับการจอง (ต้องใช้ ฿${formatMoney(totalAmount)} แต่คุณมี ฿${formatMoney(userCredit)}) กรุณาขอเติมเครดิตก่อนทำรายการ`);
      return;
    }

    setSubmitting(true);
    try {
      await api('/bookings', {
        method: 'POST',
        body: JSON.stringify({ ...booking, slotId: selected.id })
      });
      setSelected(null);
      setBooking(getInitialBookingTime());
      notify('จองที่จอดรถสำเร็จแล้ว! 🎉');
    } catch (err) {
      setModalError(err.message || 'จองไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHead
        title="จองที่จอดรถ"
        description="เลือกช่องจอดที่ว่างเพื่อทำการจอง สถานะอัปเดตจากฐานข้อมูลและเซ็นเซอร์ ESP32"
      />
      <StatCards slots={data.slots} devices={data.devices} bookings={data.bookings} user={user} />
      <div className="floor-tabs">
        <button className={floor === 1 ? 'active' : ''} onClick={() => setFloor(1)}>ชั้น 1</button>
        <button className={floor === 2 ? 'active' : ''} onClick={() => setFloor(2)}>ชั้น 2</button>
      </div>
      <section className="panel parking-panel">
        <div className="panel-title">
          <h2>ผังช่องจอด · ชั้น {floor}</h2>
          <span className="muted">{slots.length} ช่อง</span>
        </div>
        <SlotGrid slots={slots} devices={data.devices} onSelect={handleSelectSlot} />
        <div className="legend">
          <span><i className="available" />ว่าง (กดเพื่อจอง)</span>
          <span><i className="booked" />ไม่ว่าง / มีรถจอด</span>
          <span><i className="unavailable" />กำลังซ่อม</span>
        </div>
      </section>

      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
          <form className="booking-modal" onSubmit={book} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">RESERVE PARKING</p>
                <h2>จองช่อง {selected.code}</h2>
              </div>
              <button type="button" className="modal-close" onClick={() => setSelected(null)}>×</button>
            </div>
            <p className="muted">ชั้น {selected.floor} · {selected.type || 'ช่องปกติ'} · ฿20 ต่อชั่วโมง</p>

            {modalError && (
              <div className="alert error" style={{ margin: '14px 0 10px', fontSize: 13, lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span>⚠️ {modalError}</span>
              </div>
            )}

            <label>
              วันที่จอง
              <input
                required
                type="date"
                value={booking.date || ''}
                onChange={(event) => { setBooking({ ...booking, date: event.target.value }); setModalError(''); }}
              />
            </label>

            <label>
              เวลาเริ่ม
              <input
                required
                type="time"
                value={booking.time || ''}
                onChange={(event) => { setBooking({ ...booking, time: event.target.value }); setModalError(''); }}
              />
            </label>

            <label>
              จำนวนชั่วโมง (ชั่วโมงละ ฿20)
              <input
                required
                type="number"
                min="1"
                max="12"
                value={booking.duration}
                onChange={(event) => { setBooking({ ...booking, duration: Number(event.target.value) }); setModalError(''); }}
              />
            </label>

            {/* Credit & Fee Box */}
            <div className="booking-credit-summary" style={{
              marginTop: 18,
              padding: '14px 16px',
              borderRadius: 10,
              background: isInsufficient ? 'rgba(239, 68, 68, 0.08)' : 'rgba(21, 33, 38, 0.85)',
              border: `1px solid ${isInsufficient ? 'rgba(239, 68, 68, 0.35)' : 'rgba(48, 66, 82, 0.8)'}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 10
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: 13 }}>ยอดที่ต้องชำระ ({booking.duration || 1} ชม.)</span>
                <strong style={{ color: 'var(--cyan)', font: '700 20px "JetBrains Mono"' }}>฿{formatMoney(totalAmount)}</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: 13 }}>เครดิตคงเหลือของคุณ</span>
                <strong style={{ color: isInsufficient ? '#f87171' : '#34d399', font: '700 17px "JetBrains Mono"' }}>
                  ฿{formatMoney(userCredit)}
                </strong>
              </div>

              {isInsufficient ? (
                <div style={{
                  marginTop: 4,
                  paddingTop: 10,
                  borderTop: '1px dashed rgba(239, 68, 68, 0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6
                }}>
                  <span style={{ color: '#f87171', fontSize: 13, fontWeight: 600 }}>
                    ⚠️ เครดิตไม่เพียงพอ (ขาดอีก ฿{formatMoney(totalAmount - userCredit)})
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    ต้องมีเครดิตอย่างน้อย ฿{formatMoney(totalAmount)} จึงจะสามารถยืนยันการจองได้
                  </span>
                </div>
              ) : (
                <div style={{
                  marginTop: 2,
                  paddingTop: 8,
                  borderTop: '1px dashed rgba(52, 211, 153, 0.25)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 12,
                  color: '#34d399'
                }}>
                  <span>✓ เครดิตเพียงพอสำหรับการจอง</span>
                  <span style={{ color: 'var(--muted)' }}>คงเหลือหลังจอง ฿{formatMoney(userCredit - totalAmount)}</span>
                </div>
              )}
            </div>

            <div style={{ marginTop: 18 }}>
              {isInsufficient ? (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    className="button primary full"
                    onClick={() => {
                      setSelected(null);
                      setView?.('history');
                    }}
                  >
                    💳 ไปที่หน้าขอเติมเครดิต
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setSelected(null)}
                  >
                    ปิด
                  </button>
                </div>
              ) : (
                <button className="button primary full" disabled={submitting}>
                  {submitting ? 'กำลังบันทึกการจอง...' : 'ยืนยันการจอง'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function UserControl({ data, user, notify }) {
  const bookings = data.bookings.filter((item) => item.user_id === user.id && ['pending', 'active'].includes(item.status));
  const cards = bookings.map((booking) => ({ booking, slot: data.slots.find((slot) => slot.id === booking.slot_id), device: data.devices.find((device) => device.type === 'barrier' && device.linked_slot === booking.slot_id) }));
  async function toggle(device) { try { await api(`/devices/${device.id}/toggle`, { method: 'POST' }); notify(`สั่ง${device.state === 'open' ? 'ปิด' : 'เปิด'}ช่องจอดแล้ว`); } catch (err) { notify(err.message, true); } }
  return <><PageHead title="ควบคุมช่องจอด" description="คุณสามารถควบคุมได้เฉพาะช่องที่จองไว้และอยู่ในช่วงเวลาใช้งาน" /><div className="slot-grid">{cards.length ? cards.map(({ booking, slot, device }) => <div className="slot-card booked" key={booking.id}><div className="slot-top"><strong>{slot?.code || booking.slot_id}</strong><span>{booking.status}</span></div><small>{device ? `${device.name} · ${device.status}` : 'ยังไม่ได้ผูกอุปกรณ์ควบคุมกับช่องนี้'}</small>{device && <button className="button primary full" onClick={() => toggle(device)}>{device.state === 'open' ? 'ล็อกช่องจอด' : 'ปลดล็อกช่องจอด'}</button>}</div>) : <section className="panel"><p className="muted">ยังไม่มีรายการจองที่ควบคุมได้</p></section>}</div></>;
}

function UserHistory({ data, user, notify }) {
  const [request, setRequest] = useState({ amount: '', reason: '' });
  const mine = data.bookings.filter((booking) => booking.user_id === user.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const requests = (data.credit_requests || []).filter((item) => item.user_id === user.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  async function action(id, type) { try { await api(`/bookings/${id}/${type}`, { method: 'POST' }); notify(type === 'cancel' ? 'ยกเลิกและคืนเครดิตแล้ว' : 'จบการจอดแล้ว'); } catch (err) { notify(err.message, true); } }
  async function submitCredit(event) {
    event.preventDefault();
    const amount = Number(request.amount);
    if (!amount || amount < 10) return notify('กรุณาระบุจำนวนเงินอย่างน้อย ฿10', true);
    if (amount > 5000) return notify('เติมเครดิตได้ไม่เกินครั้งละ ฿5,000', true);
    if (amount % 10 !== 0) return notify('จำนวนเงินต้องเพิ่มทีละ 10 บาท', true);
    try {
      await api('/credit-requests', {
        method: 'POST',
        body: JSON.stringify({ amount, reason: request.reason?.trim() || 'ขอเติมเครดิต' })
      });
      setRequest({ amount: '', reason: '' });
      notify('ส่งคำขอเติมเครดิตแล้ว รอผู้ดูแลอนุมัติ');
    } catch (err) {
      notify(err.message, true);
    }
  }
  return <><PageHead title="ประวัติของฉัน" description="รายการจอง เครดิต และสถานะการใช้งานทั้งหมดของคุณ" />
    <section className={`panel line-connect-panel ${user.line_user_id ? 'is-linked' : 'is-unlinked'}`}>
      <div className="line-panel-inner">
        <div className="line-panel-info">
          <div className="line-avatar-wrap">
            <div className={`line-status-avatar ${user.line_user_id ? 'online' : 'offline'}`}>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="#ffffff"><path d="M19.365 9.864c0-4.043-4.195-7.324-9.365-7.324s-9.365 3.281-9.365 7.324c0 3.621 3.222 6.657 7.764 7.219.303.066.715.2.818.458.093.235.061.602.03.841l-.133.799c-.04.24-.185.938.822.512 1.007-.426 5.432-3.199 7.411-5.477 1.34-1.442 2.018-2.91 2.018-4.352zm-12.872 1.95h-.898a.382.382 0 0 1-.382-.382v-2.738c0-.211.171-.382.382-.382h.898c.211 0 .382.171.382.382v2.738a.382.382 0 0 1-.382.382zm2.086 0a.382.382 0 0 1-.382-.382v-2.738c0-.211.171-.382.382-.382h.898c.211 0 .382.171.382.382v2.738a.382.382 0 0 1-.382.382h-.898zm4.512 0a.382.382 0 0 1-.382-.382v-1.637l-1.693 2.019h-.441a.382.382 0 0 1-.382-.382v-2.738c0-.211.171-.382.382-.382h.898c.211 0 .382.171.382.382v1.637l1.693-2.019h.441a.382.382 0 0 1 .382.382v2.738a.382.382 0 0 1-.382.382h-.898zm2.67 0a.382.382 0 0 1-.382-.382v-2.738c0-.211.171-.382.382-.382h1.996c.211 0 .382.171.382.382v.457a.382.382 0 0 1-.382.382h-1.098v.481h.898c.211 0 .382.171.382.382v.457a.382.382 0 0 1-.382.382h-.898v.481h1.098c.211 0 .382.171.382.382v.457a.382.382 0 0 1-.382.382h-1.996z"/></svg>
            </div>
          </div>
          <div className="line-panel-texts">
            <div className="line-panel-header">
              <h2>{user.line_user_id ? 'เชื่อมต่อ LINE สำเร็จ' : 'การแจ้งเตือนผ่าน LINE'}</h2>
              <span className={`badge ${user.line_user_id ? 'available' : 'unavailable'}`}>
                {user.line_user_id ? '✓ เชื่อมต่อแล้ว' : 'ยังไม่เชื่อมต่อ'}
              </span>
            </div>
            <p className="line-panel-desc">
              {user.line_user_id
                ? 'ระบบผูกกับบัญชี LINE ของคุณและบอท Parking Alert Bot (@302ypwvm) แล้ว คุณจะได้รับแจ้งเตือนการจอง สรุปเวลาจอด และค่าบริการ'
                : 'เชื่อมต่อบัญชีเพื่อรับการแจ้งเตือนทันทีเมื่อจองที่จอดรถ, เตือนก่อนหมดเวลา 15 นาที และส่งสรุปค่าบริการอัตโนมัติ'}
            </p>
          </div>
        </div>
        <div className="line-panel-cta">
          {user.line_user_id ? (
            <div className="line-linked-buttons">
              <a href="https://line.me/R/ti/p/@302ypwvm" target="_blank" rel="noreferrer" className="button secondary">
                💬 เปิดห้องแชท Bot
              </a>
              <button type="button" className="button compact secondary" onClick={async () => {
                try {
                  await api('/auth/line/test-message', { method: 'POST' });
                  notify('ส่งข้อความทดสอบเข้า LINE Bot สำเร็จแล้ว! กรุณาเปิดดูใน LINE 📱');
                } catch (e) {
                  notify(e.message, true);
                }
              }}>
                🔔 เทสระบบแจ้งเตือน
              </button>
              <button type="button" className="button danger compact" onClick={async () => {
                if (!window.confirm('คุณต้องการยกเลิกการเชื่อมต่อ LINE ใช่หรือไม่?')) return;
                try {
                  await api('/auth/line/unlink', { method: 'POST' });
                  notify('ยกเลิกการเชื่อมต่อ LINE แล้ว');
                } catch (e) {
                  notify(e.message, true);
                }
              }}>
                ยกเลิกการเชื่อมต่อ
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="button line-button large" onClick={() => redirectToLine('link')}>
                <span className="line-icon-badge">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="#ffffff"><path d="M19.365 9.864c0-4.043-4.195-7.324-9.365-7.324s-9.365 3.281-9.365 7.324c0 3.621 3.222 6.657 7.764 7.219.303.066.715.2.818.458.093.235.061.602.03.841l-.133.799c-.04.24-.185.938.822.512 1.007-.426 5.432-3.199 7.411-5.477 1.34-1.442 2.018-2.91 2.018-4.352zm-12.872 1.95h-.898a.382.382 0 0 1-.382-.382v-2.738c0-.211.171-.382.382-.382h.898c.211 0 .382.171.382.382v2.738a.382.382 0 0 1-.382.382zm2.086 0a.382.382 0 0 1-.382-.382v-2.738c0-.211.171-.382.382-.382h.898c.211 0 .382.171.382.382v2.738a.382.382 0 0 1-.382.382h-.898zm4.512 0a.382.382 0 0 1-.382-.382v-1.637l-1.693 2.019h-.441a.382.382 0 0 1-.382-.382v-2.738c0-.211.171-.382.382-.382h.898c.211 0 .382.171.382.382v1.637l1.693-2.019h.441a.382.382 0 0 1 .382.382v2.738a.382.382 0 0 1-.382.382h-.898zm2.67 0a.382.382 0 0 1-.382-.382v-2.738c0-.211.171-.382.382-.382h1.996c.211 0 .382.171.382.382v.457a.382.382 0 0 1-.382.382h-1.098v.481h.898c.211 0 .382.171.382.382v.457a.382.382 0 0 1-.382.382h-.898v.481h1.098c.211 0 .382.171.382.382v.457a.382.382 0 0 1-.382.382h-1.996z"/></svg>
                </span>
                <span>เชื่อมต่อ LINE ของคุณ</span>
              </button>
              <span className="line-cta-subtext">เพิ่มเพื่อนบอท @302ypwvm อัตโนมัติ</span>
            </>
          )}
        </div>
      </div>
    </section>
    <section className="panel">
      <div className="panel-title">
        <h2>ขอเติมเครดิต</h2>
        <span className="muted">เครดิตปัจจุบัน <strong>฿{formatMoney(user.credit)}</strong></span>
      </div>
      <p className="muted" style={{ marginBottom: 14 }}>
        กรอกจำนวนเงินและรายละเอียดการชำระเงินเพื่อส่งให้ผู้ดูแลระบบตรวจสอบและอนุมัติเครดิตเข้าบัญชีของคุณ
      </p>
      <form className="booking-fields" onSubmit={submitCredit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="number"
              min="10"
              max="5000"
              step="10"
              required
              placeholder="จำนวนเงิน (บาท)"
              value={request.amount}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  setRequest({ ...request, amount: '' });
                } else {
                  const num = Number(val);
                  setRequest({ ...request, amount: num > 5000 ? 5000 : num });
                }
              }}
              style={{ minWidth: 160, maxWidth: 200, height: 42, fontWeight: 'bold' }}
            />
            <input
              style={{ flex: '1 1 240px', height: 42 }}
              placeholder="เหตุผล / หลักฐาน (ไม่บังคับ เช่น โอนผ่าน PromptPay)"
              value={request.reason}
              onChange={(e) => setRequest({ ...request, reason: e.target.value })}
            />
            <button className="button primary" style={{ height: 42, whiteSpace: 'nowrap', flex: '0 0 auto' }}>ส่งคำขอเติมเครดิต</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>เลือกยอดด่วน:</span>
            {[50, 100, 200, 500, 1000].map((val) => (
              <button
                key={val}
                type="button"
                className="button compact"
                style={{
                  fontSize: 12,
                  padding: '4px 12px',
                  background: Number(request.amount) === val ? 'rgba(54, 220, 201, 0.15)' : 'var(--surface2)',
                  borderColor: Number(request.amount) === val ? 'var(--cyan)' : 'var(--border)',
                  color: Number(request.amount) === val ? 'var(--cyan)' : '#eaf0f7'
                }}
                onClick={() => setRequest({ ...request, amount: val })}
              >
                ฿{val.toLocaleString('th-TH')}
              </button>
            ))}
            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
              * ปรับทีละ ฿10 · สูงสุดไม่เกิน ฿5,000 ต่อครั้ง
            </span>
          </div>
        </div>
      </form>
      {requests.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 18 }}>
          <table>
            <thead>
              <tr><th>จำนวน</th><th>รายละเอียด</th><th>สถานะ</th><th>วันที่ขอ</th></tr>
            </thead>
            <tbody>
              {requests.map((item) => (
                <tr key={item.id}>
                  <td><strong>฿{formatMoney(item.amount)}</strong></td>
                  <td>{item.reason}</td>
                  <td>
                    <span className={`badge ${item.status === 'approved' ? 'available' : item.status === 'rejected' ? 'unavailable' : 'pending'}`}>
                      {item.status === 'approved' ? '✓ อนุมัติแล้ว' : item.status === 'rejected' ? '✕ ปฏิเสธ' : '⏳ รออนุมัติ'}
                    </span>
                  </td>
                  <td>{formatDate(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
    <section className="panel"><div className="panel-title"><h2>รายการจองล่าสุด</h2><span className="muted">{mine.length} รายการ</span></div><div className="table-wrap"><table><thead><tr><th>ช่องจอด</th><th>วันเวลา</th><th>ระยะเวลา</th><th>ยอดเงิน</th><th>สถานะ</th><th /></tr></thead><tbody>{mine.map((booking) => <tr key={booking.id}><td>{booking.slot_id}</td><td>{booking.date} {String(booking.time).slice(0, 5)}</td><td>{booking.duration} ชั่วโมง</td><td>฿{formatMoney(booking.amount)}</td><td><span className={`badge ${booking.status}`}>{booking.status}</span></td><td>{['pending', 'active'].includes(booking.status) && <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}><button type="button" className="button compact secondary" title="ทดสอบยิงเตือนเวลาใกล้หมด 15 นาทีเข้า LINE ทันที" onClick={async () => { try { await api(`/bookings/${booking.id}/test-remind`, { method: 'POST' }); notify(`ยิงแจ้งเตือนใกล้หมดเวลาช่อง ${booking.slot_id} เข้า LINE แล้ว ⏰`); } catch (err) { notify(err.message, true); } }}>⏰ เทสเตือนหมดเวลา</button><button type="button" className="button primary compact" onClick={() => action(booking.id, 'finish')}>จบการจอด (รับสลิป)</button>{booking.status === 'pending' && new Date(`${booking.date}T${String(booking.time).slice(0, 5)}:00+07:00`) > new Date() && <button type="button" className="button danger compact" onClick={() => action(booking.id, 'cancel')}>ยกเลิก</button>}</div>}</td></tr>)}</tbody></table></div></section></>;
}

function AdminDashboard({ data }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  const revenue = data.bookings.filter((booking) => booking.date === today && booking.status !== 'cancelled').reduce((sum, booking) => sum + Number(booking.amount || 0), 0);
  const bookings = [...data.bookings].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const userName = (id) => data.users.find((item) => item.id === id)?.name || id;
  return <><PageHead title="ภาพรวมและประวัติการจอง" description="ติดตามสถานะพื้นที่จอดและตรวจสอบรายการจองทั้งหมด" /><StatCards slots={data.slots} devices={data.devices} bookings={data.bookings} user={{ role: 'admin' }} />
    <section className="panel"><div className="panel-title"><h2>รายได้วันนี้</h2><strong className="highlight">฿{formatMoney(revenue)}</strong></div><p className="muted">รวมจากรายการจองประจำวันที่ {today}</p></section>
    <section className="panel"><div className="panel-title"><h2>ประวัติการจองทั้งหมด</h2><span className="muted">{bookings.length} รายการ</span></div><div className="table-wrap"><table><thead><tr><th>ช่องจอด</th><th>ผู้จอง</th><th>วันที่</th><th>เวลา</th><th>ระยะเวลา</th><th>จำนวนเงิน</th><th>สถานะ</th><th>ทำรายการเมื่อ</th></tr></thead><tbody>{bookings.length ? bookings.map((booking) => <tr key={booking.id}><td>{booking.slot_id}</td><td>{userName(booking.user_id)}</td><td>{booking.date}</td><td>{String(booking.time).slice(0, 5)}</td><td>{booking.duration} ชั่วโมง</td><td>฿{formatMoney(booking.amount)}</td><td><span className={`badge ${booking.status}`}>{booking.status}</span></td><td>{new Date(booking.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</td></tr>) : <tr><td colSpan="8">ยังไม่มีรายการจอง</td></tr>}</tbody></table></div></section></>;
}

function AdminUsers({ data, notify }) {
  const [activeTab, setActiveTab] = useState('pending');
  const pending = (data.credit_requests || []).filter((item) => item.status === 'pending');
  const allRequests = [...(data.credit_requests || [])].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const userName = (id) => data.users.find((item) => item.id === id)?.name || id;
  const userUsername = (id) => data.users.find((item) => item.id === id)?.username || id;
  const creditHistory = [...(data.credit_history || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  async function adjust(item, type) {
    const amount = Number(window.prompt(`${type === 'add' ? 'เพิ่ม' : 'หัก'}เครดิตของ ${item.name} จำนวนเท่าไร?`, '100'));
    if (!amount) return;
    const reason = window.prompt('เหตุผล', type === 'add' ? 'เติมเครดิตโดยผู้ดูแล' : 'หักเครดิตโดยผู้ดูแล');
    if (!reason) return;
    try {
      await api(`/admin/users/${item.id}/credit`, { method: 'POST', body: JSON.stringify({ type, amount, reason }) });
      notify('ปรับเครดิตเรียบร้อย');
    } catch (err) {
      notify(err.message, true);
    }
  }

  async function updateUser(item, patch) {
    try {
      await api(`/admin/users/${item.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      notify('อัปเดตผู้ใช้แล้ว กรุณาให้ผู้ใช้ออกจากระบบและเข้าใหม่หากเปลี่ยนบทบาท');
    } catch (err) {
      notify(err.message, true);
    }
  }

  async function review(id, action) {
    try {
      await api(`/admin/credit-requests/${id}/${action}`, { method: 'POST' });
      notify(action === 'approve' ? 'อนุมัติคำขอเติมเครดิตแล้ว ✅' : 'ปฏิเสธคำขอแล้ว ❌');
    } catch (err) {
      notify(err.message, true);
    }
  }

  return (
    <>
      <PageHead title="จัดการผู้ใช้ & คำขอเครดิต" description="ตรวจสอบคำขอเติมเครดิต อนุมัติ/ปฏิเสธ เปลี่ยนบทบาท และจัดการผู้ใช้งาน" />

      {/* Credit Requests Section */}
      <section className="panel">
        <div className="panel-title">
          <h2>คำขอเติมเครดิต</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={`button compact ${activeTab === 'pending' ? 'primary' : ''}`}
              onClick={() => setActiveTab('pending')}
            >
              ⏳ รอดำเนินการ ({pending.length})
            </button>
            <button
              type="button"
              className={`button compact ${activeTab === 'all' ? 'primary' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              📋 ประวัติคำขอทั้งหมด ({allRequests.length})
            </button>
          </div>
        </div>

        {activeTab === 'pending' ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>ผู้ใช้</th><th>ชื่อบัญชี</th><th>จำนวน</th><th>เหตุผล / หลักฐาน</th><th>วันที่ขอ</th><th /></tr>
              </thead>
              <tbody>
                {pending.length ? pending.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{userName(item.user_id)}</strong></td>
                    <td><span className="muted">{userUsername(item.user_id)}</span></td>
                    <td><strong style={{ color: 'var(--cyan)' }}>฿{formatMoney(item.amount)}</strong></td>
                    <td>{item.reason}</td>
                    <td>{formatDate(item.created_at)}</td>
                    <td>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button className="button primary compact" onClick={() => review(item.id, 'approve')}>✓ อนุมัติ</button>
                        <button className="button danger compact" onClick={() => review(item.id, 'reject')}>✕ ปฏิเสธ</button>
                      </div>
                    </td>
                  </tr>
                )) : <tr><td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)' }}>ไม่มีคำขอที่รอดำเนินการ</td></tr>}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>ผู้ใช้</th><th>ชื่อบัญชี</th><th>จำนวน</th><th>เหตุผล / หลักฐาน</th><th>สถานะ</th><th>วันที่ขอ</th><th>วันที่อนุมัติ</th></tr>
              </thead>
              <tbody>
                {allRequests.length ? allRequests.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{userName(item.user_id)}</strong></td>
                    <td><span className="muted">{userUsername(item.user_id)}</span></td>
                    <td><strong style={{ color: item.status === 'approved' ? 'var(--cyan)' : 'inherit' }}>฿{formatMoney(item.amount)}</strong></td>
                    <td>{item.reason}</td>
                    <td>
                      <span className={`badge ${item.status === 'approved' ? 'available' : item.status === 'rejected' ? 'unavailable' : 'pending'}`}>
                        {item.status === 'approved' ? '✓ อนุมัติแล้ว' : item.status === 'rejected' ? '✕ ปฏิเสธ' : '⏳ รออนุมัติ'}
                      </span>
                    </td>
                    <td>{formatDate(item.created_at)}</td>
                    <td>{item.reviewed_at ? new Date(item.reviewed_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-'}</td>
                  </tr>
                )) : <tr><td colSpan="7" style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)' }}>ยังไม่มีประวัติคำขอเติมเครดิต</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Users Management Section */}
      <section className="panel">
        <div className="panel-title">
          <h2>รายชื่อผู้ใช้ทั้งหมด</h2>
          <span className="muted">{data.users.length} คน</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>ชื่อ</th><th>ชื่อผู้ใช้</th><th>LINE</th><th>บทบาท</th><th>เครดิต</th><th>สถานะ</th><th /></tr>
            </thead>
            <tbody>
              {data.users.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.name}</strong></td>
                  <td><span className="muted">{item.username}</span></td>
                  <td>
                    <span className={`badge ${item.line_user_id ? 'available' : 'unavailable'}`}>
                      {item.line_user_id ? '✓ เชื่อมต่อแล้ว' : 'ยังไม่เชื่อมต่อ'}
                    </span>
                  </td>
                  <td>
                    <select
                      value={item.role}
                      disabled={item.id === JSON.parse(localStorage.user || '{}').id}
                      onChange={(e) => updateUser(item, { role: e.target.value })}
                    >
                      <option value="user">ผู้ใช้</option>
                      <option value="admin">ผู้ดูแลระบบ</option>
                    </select>
                  </td>
                  <td>
                    <strong style={{ color: Number(item.credit || 0) > 0 ? '#34d399' : '#f87171' }}>
                      ฿{formatMoney(item.credit)}
                    </strong>
                  </td>
                  <td>
                    <button className="button compact" onClick={() => updateUser(item, { status: item.status === 'active' ? 'inactive' : 'active' })}>
                      {item.status}
                    </button>
                  </td>
                  <td>
                    {item.role !== 'admin' && (
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button className="button primary compact" onClick={() => adjust(item, 'add')}>+ เพิ่มเครดิต</button>
                        <button className="button danger compact" onClick={() => adjust(item, 'reduce')}>- หักเครดิต</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Credit History Section */}
      <section className="panel">
        <div className="panel-title">
          <h2>ประวัติการทำรายการเครดิตทั้งหมด</h2>
          <span className="muted">{creditHistory.length} รายการ</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>วันที่-เวลา</th><th>ผู้ใช้</th><th>ประเภท</th><th>จำนวน</th><th>รายละเอียด</th><th>ที่มา</th></tr>
            </thead>
            <tbody>
              {creditHistory.length ? creditHistory.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.date).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</td>
                  <td><strong>{userName(item.user_id)}</strong></td>
                  <td>
                    <span className={`badge ${item.type === 'add' ? 'available' : 'unavailable'}`}>
                      {item.type === 'add' ? '+ เพิ่มเครดิต' : '- หักเครดิต'}
                    </span>
                  </td>
                  <td className={item.type === 'add' ? 'highlight' : ''}>
                    {item.type === 'add' ? '+' : '-'}฿{formatMoney(item.amount)}
                  </td>
                  <td>{item.reason}</td>
                  <td>{item.source}</td>
                </tr>
              )) : <tr><td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)' }}>ยังไม่มีประวัติเครดิต</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function AdminDevices({ data, reload, notify }) {
  async function toggle(device) { try { await api(`/devices/${device.id}/toggle`, { method: 'POST' }); await reload(); notify('อัปเดตสถานะอุปกรณ์แล้ว'); } catch (err) { notify(err.message, true); } }
  async function rename(device) { const name = window.prompt('ชื่ออุปกรณ์ใหม่', device.name); if (!name) return; try { await api(`/admin/devices/${device.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); notify('เปลี่ยนชื่ออุปกรณ์แล้ว'); } catch (err) { notify(err.message, true); } }
  async function link(device) { const linked_slot = window.prompt('รหัสช่องจอดที่ต้องการผูก เช่น A1 (เว้นว่างเพื่อล้าง)', device.linked_slot || ''); try { await api(`/admin/devices/${device.id}`, { method: 'PATCH', body: JSON.stringify({ linked_slot: linked_slot || null }) }); notify('อัปเดตช่องที่เชื่อมโยงแล้ว'); } catch (err) { notify(err.message, true); } }
  return <><PageHead title="อุปกรณ์ / ไม้กั้น" description="ตรวจสอบ เปลี่ยนชื่อ ผูกช่องจอด และสั่งงานอุปกรณ์ IoT" /><section className="panel table-wrap"><table><thead><tr><th>ชื่ออุปกรณ์</th><th>ประเภท</th><th>ช่องที่ผูก</th><th>ชั้น</th><th>สถานะ</th><th>การทำงาน</th><th /></tr></thead><tbody>{data.devices.map((device) => <tr key={device.id}><td>{device.name}</td><td>{device.type}</td><td>{device.linked_slot || '-'}</td><td>{device.floor}</td><td><span className={`badge ${device.status}`}>{device.status}</span></td><td>{device.state || device.presence || '-'}</td><td><button className="button compact" onClick={() => rename(device)}>เปลี่ยนชื่อ</button> <button className="button compact" onClick={() => link(device)}>ผูกช่อง</button> {device.type === 'barrier' && <button className="button primary compact" onClick={() => toggle(device)}>เปิด/ปิด</button>}</td></tr>)}</tbody></table></section></>;
}

function AdminLayout({ data, notify }) {
  const [selected, setSelected] = useState(null);
  const [floor, setFloor] = useState(1);
  const slots = data.slots.filter((slot) => slot.floor === floor).sort((a, b) => a.slot_order - b.slot_order);
  const maps = (data.parking_maps || []).filter((item) => item.floor === floor);
  const openMaintenance = (data.maintenance_logs || []).filter((item) => item.status === 'open');
  async function patchSlot(slot, patch) { try { await api(`/admin/slots/${slot.id}`, { method: 'PATCH', body: JSON.stringify(patch) }); notify('อัปเดตช่องจอดแล้ว'); } catch (err) { notify(err.message, true); } }
  async function rename(slot) { const code = window.prompt('ชื่อช่องจอดใหม่', slot.code); if (code) patchSlot(slot, { code }); }
  async function chooseSwap(slot) { if (!selected) return setSelected(slot.id); if (selected === slot.id) return setSelected(null); try { await api('/admin/slots/swap', { method: 'POST', body: JSON.stringify({ firstId: selected, secondId: slot.id }) }); setSelected(null); notify('สลับตำแหน่งช่องจอดแล้ว'); } catch (err) { notify(err.message, true); } }
  async function maintenance(slot) { const problemDetail = window.prompt(`รายละเอียดการซ่อมช่อง ${slot.code}`); if (!problemDetail) return; try { await api('/admin/maintenance', { method: 'POST', body: JSON.stringify({ slotId: slot.id, problemDetail }) }); notify('แจ้งซ่อมแล้ว ช่องถูกเปลี่ยนเป็นสีเทา'); } catch (err) { notify(err.message, true); } }
  async function resolve(item) { try { await api(`/admin/maintenance/${item.id}/resolve`, { method: 'POST' }); notify('ปิดงานซ่อมและคืนสถานะช่องว่างแล้ว'); } catch (err) { notify(err.message, true); } }
  async function uploadMap(event) { event.preventDefault(); const form = new FormData(event.currentTarget); form.set('floor', floor); try { await api('/admin/maps', { method: 'POST', body: form }); event.currentTarget.reset(); notify('อัปโหลดผังลานจอดแล้ว'); } catch (err) { notify(err.message, true); } }
  return <><PageHead title="จัดการผังลานจอด" description="คลิกช่อง 2 ช่องเพื่อสลับตำแหน่ง เปลี่ยนชื่อ สถานะ หรือแจ้งซ่อม" /><div className="tabs"><button className={floor === 1 ? 'active' : ''} onClick={() => setFloor(1)}>ชั้น 1</button><button className={floor === 2 ? 'active' : ''} onClick={() => setFloor(2)}>ชั้น 2</button></div>
    <section className="panel"><div className="panel-title"><h2>อัปโหลดรูปผังชั้น {floor}</h2></div><form className="booking-fields" onSubmit={uploadMap}><input name="name" required placeholder={`ชื่อผัง เช่น อาคาร A ชั้น ${floor}`} /><input name="image" type="file" accept="image/png,image/jpeg,image/webp" required /><button className="button primary">อัปโหลดรูป</button></form>{maps.map((item) => <img key={item.id} src={item.image_url} alt={item.name} style={{ width: '100%', maxHeight: 520, objectFit: 'contain', marginTop: 16, borderRadius: 12 }} />)}</section>
    <section className="panel"><div className="slot-grid">{slots.map((slot) => <div className={`slot-card ${slot.status}`} key={slot.id} style={selected === slot.id ? { outline: '2px solid #22d3ee' } : {}}><div className="slot-top"><strong>{slot.code}</strong><span>{slot.status}</span></div><small>ลำดับ {slot.slot_order} · {slot.type}</small><button className="button compact" onClick={() => chooseSwap(slot)}>{selected ? 'เลือกเพื่อสลับ' : 'เลือกสลับตำแหน่ง'}</button> <button className="button compact" onClick={() => rename(slot)}>เปลี่ยนชื่อ</button><select value={slot.status} onChange={(e) => patchSlot(slot, { status: e.target.value })}><option value="available">ว่าง</option><option value="booked">ถูกจอง</option><option value="unavailable">ไม่พร้อม/ซ่อม</option></select><button className="button danger compact" onClick={() => maintenance(slot)}>แจ้งซ่อม</button></div>)}</div></section>
    <section className="panel"><div className="panel-title"><h2>ประวัติการซ่อมบำรุง</h2><span className="muted">{(data.maintenance_logs || []).length} รายการ</span></div><div className="table-wrap"><table><thead><tr><th>ช่องจอด</th><th>รายละเอียดปัญหา</th><th>สถานะ</th><th>แจ้งเมื่อ</th><th>ปิดงานเมื่อ</th><th /></tr></thead><tbody>{(data.maintenance_logs || []).slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).map((item) => <tr key={item.id}><td>{item.slot_id}</td><td>{item.problem_detail}</td><td><span className={`badge ${item.status === 'open' ? 'unavailable' : 'available'}`}>{item.status === 'open' ? 'กำลังซ่อม' : 'ปิดงานแล้ว'}</span></td><td>{new Date(item.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</td><td>{item.resolved_at ? new Date(item.resolved_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-'}</td><td>{item.status === 'open' && <button className="button primary compact" onClick={() => resolve(item)}>ซ่อมเสร็จ</button>}</td></tr>)}</tbody></table></div></section></>;
}

function App() {
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.user || 'null'); } catch { localStorage.clear(); return null; } });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState(() => { try { return JSON.parse(localStorage.user || 'null')?.role === 'admin' ? 'dashboard' : 'booking'; } catch { return 'booking'; } });
  const [notice, setNotice] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  async function load() {
    if (!localStorage.token) { localStorage.clear(); setUser(null); return; }
    setLoading(true); setLoadError('');
    try {
      const next = await api('/bootstrap');
      setData(next);
      setLastUpdated(new Date());
      const liveUser = next.users?.find((item) => item.id === user?.id);
      if (liveUser) { localStorage.user = JSON.stringify(liveUser); setUser((current) => ({ ...current, ...liveUser })); }
    } catch (err) {
      if (err.status === 401) { localStorage.clear(); setUser(null); setData(null); return; }
      setLoadError(err instanceof TypeError ? 'เชื่อมต่อ Backend ไม่ได้ กรุณาตรวจสอบว่า Backend เปิดที่ Port 3000' : err.message);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (!user) return;
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [user?.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      window.history.replaceState({}, document.title, window.location.pathname);
      const redirectUri = window.location.origin;
      setLoading(true);
      api('/auth/line', { method: 'POST', body: JSON.stringify({ code, redirectUri }) })
        .then((res) => {
          if (res.mode === 'linked') {
            localStorage.user = JSON.stringify(res.user);
            setUser((curr) => ({ ...curr, ...res.user }));
            setNotice({ text: 'เชื่อมต่อ LINE สำเร็จแล้ว! พร้อมรับการแจ้งเตือนทันที 🎉', error: false });
            load();
          } else {
            localStorage.token = res.token;
            localStorage.user = JSON.stringify(res.user);
            setUser(res.user);
            setData(null);
            setView(res.user.role === 'admin' ? 'dashboard' : 'booking');
            setNotice({ text: `ยินดีต้อนรับคุณ ${res.user.name} เข้าสู่ระบบสำเร็จ 🎉`, error: false });
          }
        })
        .catch((err) => {
          setNotice({ text: err.message || 'เชื่อมต่อ LINE ไม่สำเร็จ', error: true });
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, []);

  const notify = (text, error = false) => { setNotice({ text, error }); load(); };
  const logout = () => { localStorage.clear(); setUser(null); setData(null); setLoadError(''); };

  if (!user) return <Login onLogin={(next) => { setUser(next); setData(null); setView(next.role === 'admin' ? 'dashboard' : 'booking'); }} />;
  if (loading && !data) return <div className="loading"><div><div className="loading-spinner" /><p>กำลังโหลดข้อมูลระบบ...</p></div></div>;
  if (loadError && !data) return <div className="loading"><div className="load-error"><h2>เชื่อมต่อระบบไม่สำเร็จ</h2><p>{loadError}</p><div><button className="button primary" onClick={load}>ลองใหม่</button><button className="button" onClick={logout}>กลับไปเข้าสู่ระบบ</button></div><small>ทดสอบ Backend ที่ http://localhost:3000/api/health</small></div></div>;
  if (!data) return <div className="loading"><button className="button primary" onClick={load}>โหลดข้อมูลระบบ</button></div>;

  const liveUser = data.users.find((item) => item.id === user.id) || user;
  const content = liveUser.role === 'admin'
    ? { dashboard: <AdminDashboard data={data} />, users: <AdminUsers data={data} notify={notify} />, devices: <AdminDevices data={data} reload={load} notify={notify} />, layout: <AdminLayout data={data} notify={notify} /> }[view]
    : { booking: <UserBooking data={data} user={liveUser} notify={notify} setView={setView} />, control: <UserControl data={data} user={liveUser} notify={notify} />, history: <UserHistory data={data} user={liveUser} notify={notify} /> }[view];
  return <div className="app-shell"><Header user={liveUser} onLogout={logout} lastUpdated={lastUpdated} /><div className="body-shell"><Sidebar user={liveUser} view={view} setView={setView} /><main className="content">{notice && <div className={`alert ${notice.error ? 'error' : 'success'}`}>{notice.text}<button onClick={() => setNotice(null)}>×</button></div>}{loadError && <div className="alert error">{loadError}<button onClick={load}>ลองใหม่</button></div>}{content}</main></div></div>;
}

createRoot(document.getElementById('root')).render(<App />);
