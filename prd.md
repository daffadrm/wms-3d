# WMS 3D — Technical Specification

## 1. Overview

WMS 3D adalah aplikasi Warehouse Management System dengan pendekatan visual 3D menggunakan **Three.js** melalui **React Three Fiber**.

Aplikasi dirancang untuk memberikan pengalaman pengelolaan warehouse yang lebih intuitif dengan menampilkan kondisi gudang secara visual, termasuk rack, location, inventory, pallet, dan pergerakan barang.

Berbeda dengan WMS konvensional yang mayoritas menggunakan tabel, WMS 3D menjadikan **3D warehouse sebagai salah satu interface utama** untuk memahami kondisi operasional gudang.

---

# 2. Goals

Tujuan utama aplikasi:

1. Menampilkan warehouse dalam bentuk visual 3D.
2. Menampilkan rack dan storage location secara interaktif.
3. Menampilkan status inventory secara visual.
4. Memungkinkan user memilih location dengan klik.
5. Menampilkan detail inventory berdasarkan location.
6. Menampilkan occupancy setiap location.
7. Menampilkan pergerakan barang secara visual.
8. Menjadi foundation untuk pengembangan WMS yang lebih lengkap.
9. Memungkinkan data warehouse dari backend ditampilkan secara dinamis ke scene 3D.

---

# 3. Technology Stack

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- React Three Fiber
- Three.js
- Drei
- Zustand

## Backend

Untuk tahap MVP, backend belum diperlukan.

Dummy data akan digunakan terlebih dahulu.

Tahap berikutnya:

- Python
- FastAPI
- PostgreSQL

## 3D Engine

- Three.js
- React Three Fiber

## Development

```bash
npm install
npm run dev
```

---

# 4. Application Architecture

```text
                    ┌──────────────────┐
                    │    PostgreSQL    │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │     FastAPI      │
                    │     Backend      │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │      Next.js     │
                    │    Frontend      │
                    └────────┬─────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
                ▼                         ▼
        ┌───────────────┐         ┌───────────────┐
        │  WMS UI       │         │  3D Scene     │
        │ Dashboard     │         │ Three.js      │
        │ Inventory     │         │ Rack          │
        │ Movement      │         │ Pallet        │
        └───────────────┘         │ Forklift      │
                                  └───────────────┘
```

---

# 5. Main Concept

Warehouse direpresentasikan sebagai environment 3D.

Struktur:

```text
Warehouse
│
├── Floor
│
├── Zone A
│   ├── Rack A01
│   │   ├── Location A01-01
│   │   ├── Location A01-02
│   │   └── Location A01-03
│   │
│   └── Rack A02
│
├── Zone B
│   ├── Rack B01
│   └── Rack B02
│
├── Receiving Area
├── Packing Area
└── Shipping Area
```

---

# 6. 3D Warehouse

## 6.1 Floor

Warehouse memiliki floor sebagai dasar scene.

Floor digunakan sebagai:

- area warehouse
- area movement
- referensi posisi object
- dasar visual warehouse

---

## 6.2 Rack

Rack dibuat secara procedural menggunakan Three.js.

Setiap rack terdiri dari:

```text
Rack
├── Frame
├── Level 1
├── Level 2
├── Level 3
└── Level 4
```

Setiap level dapat memiliki beberapa location.

Contoh:

```text
┌─────┬─────┬─────┐
│ A01 │ A02 │ A03 │ Level 4
├─────┼─────┼─────┤
│ A01 │ A02 │ A03 │ Level 3
├─────┼─────┼─────┤
│ A01 │ A02 │ A03 │ Level 2
├─────┼─────┼─────┤
│ A01 │ A02 │ A03 │ Level 1
└─────┴─────┴─────┘
```

---

# 7. Storage Location

Setiap location memiliki data:

```typescript
interface WarehouseLocation {
  id: string;
  code: string;
  rackId: string;
  level: number;
  capacity: number;
  stock: number;
  status: LocationStatus;
}
```

Status:

```text
EMPTY
AVAILABLE
ALMOST_FULL
FULL
```

Status ditentukan berdasarkan occupancy.

```text
occupancy = stock / capacity * 100
```

Contoh:

```text
0%       → EMPTY
1-70%    → AVAILABLE
71-90%   → ALMOST_FULL
91-100%  → FULL
```

---

# 8. Visual Status

Setiap location memiliki visual berdasarkan status.

```text
EMPTY
    ↓
Location kosong

AVAILABLE
    ↓
Location memiliki kapasitas yang masih cukup

ALMOST_FULL
    ↓
Location hampir penuh

FULL
    ↓
Location penuh
```

Status akan digunakan untuk memberikan visual feedback pada warehouse.

---

# 9. Inventory

Inventory menyimpan informasi barang yang berada pada location.

```typescript
interface Inventory {
  id: string;
  locationId: string;
  sku: string;
  productName: string;
  quantity: number;
  reservedQuantity: number;
}
```

Contoh:

```json
{
  "id": "INV-001",
  "locationId": "LOC-A01-01",
  "sku": "SKU-00123",
  "productName": "Plastic Container 20L",
  "quantity": 240,
  "reservedQuantity": 40
}
```

Available stock:

```text
Available = Quantity - Reserved Quantity
```

---

# 10. Interactive Location

User dapat melakukan:

- hover location
- click location
- melihat status location
- melihat inventory
- melihat occupancy

Ketika location dipilih:

```text
A01-01

SKU
SKU-00123

Product
Plastic Container 20L

Stock
240 PCS

Reserved
40 PCS

Available
200 PCS

Capacity
300 PCS

Occupancy
80%
```

Location yang dipilih akan mendapatkan visual highlight.

---

# 11. Camera

Camera menggunakan Perspective Camera.

User dapat:

- rotate
- zoom
- pan
- melihat warehouse dari berbagai sudut

Library:

```text
@react-three/drei
```

Camera control:

```text
OrbitControls
```

Default camera diarahkan ke bagian tengah warehouse.

---

# 12. Lighting

Scene menggunakan kombinasi:

- Ambient Light
- Directional Light

Tujuan:

- warehouse tetap terlihat jelas
- object memiliki depth
- rack terlihat tiga dimensi
- tidak terlalu berat untuk browser

---

# 13. Pallet

Pallet direpresentasikan sebagai object 3D.

Struktur:

```text
Pallet
├── Base
└── Boxes
```

Pallet dapat ditempatkan pada location berdasarkan inventory.

Contoh:

```text
Rack A01

┌───────────────┐
│ 📦 📦 📦       │
├───────────────┤
│ 📦 📦          │
├───────────────┤
│               │
└───────────────┘
```

Jumlah box secara visual dapat disederhanakan agar tidak terlalu banyak object.

---

# 14. Forklift

MVP menggunakan forklift sederhana yang dibuat menggunakan geometry Three.js.

Struktur:

```text
Forklift
├── Body
├── Wheels
├── Mast
└── Fork
```

Forklift digunakan sebagai dasar untuk fitur movement animation.

---

# 15. Movement

Movement merupakan proses perpindahan inventory dari satu location ke location lain.

Contoh:

```text
Receiving
    ↓
Location A01-01
    ↓
Location B02-03
    ↓
Packing
    ↓
Shipping
```

Pada tahap MVP, movement dapat divisualisasikan menggunakan animasi sederhana.

Contoh:

```text
📦 ───────────────→ 📦
A01                 B03
```

---

# 16. Movement Data

```typescript
interface InventoryMovement {
  id: string;
  sku: string;
  fromLocation: string;
  toLocation: string;
  quantity: number;
  status: MovementStatus;
}
```

Status:

```text
PENDING
IN_PROGRESS
COMPLETED
```

---

# 17. Movement Animation

Ketika movement dijalankan:

```text
1. User memilih inventory
2. User memilih destination
3. Sistem membuat movement
4. Forklift bergerak
5. Pallet mengikuti forklift
6. Pallet sampai di destination
7. Inventory location diperbarui
```

Visual:

```text
         ┌──────────┐
         │ Rack B03 │
         └──────────┘
              ↑
              │
             🚜
              ↑
              │
             📦
              │
              │
         ┌──────────┐
         │ Rack A01 │
         └──────────┘
```

---

# 18. Warehouse Dashboard

Selain 3D scene, aplikasi memiliki dashboard informasi.

Contoh:

```text
┌──────────────────────────────────────────────┐
│ Warehouse Overview                           │
├──────────┬──────────┬──────────┬─────────────┤
│ Location │ Capacity │ Occupied │ Available   │
│ 120      │ 10,000   │ 7,240    │ 2,760       │
└──────────┴──────────┴──────────┴─────────────┘
```

KPI:

- Total Location
- Total Capacity
- Occupied Capacity
- Available Capacity
- Total SKU
- Total Inventory
- Active Movement

---

# 19. UI Layout

Konsep halaman:

```text
┌───────────────────────────────────────────────────────┐
│ WMS 3D                            Search    User       │
├───────────────┬───────────────────────────────────────┤
│               │                                       │
│ Dashboard     │                                       │
│ Warehouse     │          3D WAREHOUSE                 │
│ Inventory     │                                       │
│ Movement      │          🗄️   🗄️   🗄️                │
│               │                                       │
│               │               🚜                      │
│               │                                       │
│               │          🗄️   🗄️   🗄️                │
│               │                                       │
└───────────────┴───────────────────────────────────────┘
```

Ketika location dipilih:

```text
┌───────────────────────────────────────┐
│ Location Detail                   X   │
├───────────────────────────────────────┤
│ Location: A01-03                      │
│                                       │
│ SKU: SKU-00123                        │
│ Product: Product Example               │
│                                       │
│ Stock       240 PCS                   │
│ Reserved     40 PCS                   │
│ Available   200 PCS                   │
│                                       │
│ Capacity    300 PCS                   │
│ Occupancy     80%                     │
│                                       │
│ [View Inventory]                      │
└───────────────────────────────────────┘
```

---

# 20. Project Structure

```text
wms-3d/
│
├── app/
│   ├── page.tsx
│   ├── layout.tsx
│   └── globals.css
│
├── components/
│   ├── warehouse/
│   │   ├── WarehouseScene.tsx
│   │   ├── WarehouseFloor.tsx
│   │   ├── Rack.tsx
│   │   ├── Location.tsx
│   │   ├── Pallet.tsx
│   │   ├── Forklift.tsx
│   │   └── Movement.tsx
│   │
│   ├── dashboard/
│   │   ├── KPI.tsx
│   │   └── WarehouseStats.tsx
│   │
│   └── inventory/
│       └── LocationDetail.tsx
│
├── data/
│   └── warehouse.ts
│
├── types/
│   └── warehouse.ts
│
├── store/
│   └── warehouseStore.ts
│
├── lib/
│   └── warehouse.ts
│
└── public/
```

---

# 21. Component Architecture

```text
WarehousePage
│
├── Header
│
├── Sidebar
│
├── WarehouseDashboard
│
└── WarehouseScene
    │
    ├── Camera
    ├── Lights
    ├── Floor
    │
    ├── Zone
    │   ├── Rack
    │   │   ├── Location
    │   │   ├── Location
    │   │   └── Location
    │   │
    │   └── Rack
    │
    ├── Pallet
    ├── Forklift
    └── Movement
```

---

# 22. State Management

Zustand digunakan untuk state warehouse.

State utama:

```typescript
interface WarehouseState {
  selectedLocationId: string | null;
  selectedInventoryId: string | null;
  selectedMovementId: string | null;

  selectLocation: (id: string) => void;
  selectInventory: (id: string) => void;
  selectMovement: (id: string) => void;
}
```

---

# 23. Dummy Data

MVP menggunakan dummy data.

Contoh:

```typescript
const locations = [
  {
    id: "LOC-001",
    code: "A01-01",
    rackId: "RACK-A01",
    level: 1,
    capacity: 300,
    stock: 240,
    status: "ALMOST_FULL",
  },
  {
    id: "LOC-002",
    code: "A01-02",
    rackId: "RACK-A01",
    level: 2,
    capacity: 300,
    stock: 100,
    status: "AVAILABLE",
  },
];
```

---

# 24. Future Backend API

Setelah MVP selesai, dummy data akan diganti dengan API.

## Warehouse

```http
GET /api/warehouses
GET /api/warehouses/:id
```

## Locations

```http
GET /api/warehouses/:id/locations
GET /api/locations/:id
```

## Inventory

```http
GET /api/inventory
GET /api/inventory/:id
```

## Movement

```http
GET /api/movements
POST /api/movements
GET /api/movements/:id
```

---

# 25. Database Concept

Struktur database tahap berikutnya:

```text
warehouses
    │
    ├── zones
    │     │
    │     └── racks
    │            │
    │            └── locations
    │
    └── areas

products
    │
    └── inventory
             │
             └── locations

inventory_movements
    │
    ├── from_location
    └── to_location
```

---

# 26. Performance Considerations

Karena Three.js digunakan untuk menampilkan banyak object, performa harus diperhatikan.

Target:

- Tidak membuat object 3D secara berlebihan.
- Menggunakan reusable geometry.
- Menggunakan instancing jika diperlukan.
- Membatasi jumlah polygon.
- Menghindari texture berukuran besar.
- Menggunakan level of detail untuk warehouse besar.
- Hanya menampilkan detail object ketika diperlukan.

Untuk MVP, jumlah object dibatasi terlebih dahulu.

---

# 27. Responsive Behavior

Desktop menjadi target utama karena warehouse visualization membutuhkan layar besar.

Minimum target:

```text
Desktop
1920 × 1080
1440 × 900
1366 × 768
```

Tablet/mobile dapat diberikan tampilan dashboard alternatif apabila 3D scene terlalu sempit.

---

# 28. MVP Scope

MVP wajib memiliki:

### Warehouse

- [x] 3D floor
- [x] Rack
- [x] Location
- [x] Zone
- [x] Camera control

### Inventory

- [x] Dummy inventory
- [x] Stock
- [x] Capacity
- [x] Occupancy
- [x] Location status

### Interaction

- [x] Hover location
- [x] Click location
- [x] Highlight selected location
- [x] Location detail panel

### Object

- [x] Pallet
- [x] Box
- [x] Basic forklift

### Movement

- [x] Dummy movement
- [x] Basic movement animation

### Dashboard

- [x] Total locations
- [x] Capacity
- [x] Occupancy
- [x] Inventory
- [x] Active movements

---

# 29. Out of Scope MVP

Fitur berikut belum masuk MVP:

- Authentication
- Authorization
- Real-time WebSocket
- Barcode scanning
- QR scanning
- Actual forklift integration
- IoT sensor
- Camera integration
- AI optimization
- Route optimization
- Advanced 3D physics
- Multiplayer
- Digital twin real-time
- Mobile application

Fitur tersebut dapat dikembangkan pada tahap berikutnya.

---

# 30. Development Roadmap

## Phase 1 — 3D Foundation

```text
Next.js
+
React Three Fiber
+
Three.js
```

Implement:

- Canvas
- Camera
- Lighting
- Floor
- Basic warehouse

---

## Phase 2 — Warehouse

Implement:

- Zone
- Rack
- Location
- Storage level
- Location status

---

## Phase 3 — Inventory

Implement:

- Product
- Inventory
- Pallet
- Box
- Location detail

---

## Phase 4 — Interaction

Implement:

- Hover
- Click
- Highlight
- Selection
- Detail panel

---

## Phase 5 — Movement

Implement:

- Forklift
- Pallet movement
- Movement animation
- Movement status

---

## Phase 6 — Dashboard

Implement:

- KPI
- Occupancy
- Inventory summary
- Active movement
- Warehouse statistics

---

## Phase 7 — Backend

Implement:

```text
FastAPI
+
PostgreSQL
```

Replace dummy data with real API.

---

## Phase 8 — Advanced WMS

Future features:

- Receiving
- Putaway
- Picking
- Packing
- Shipping
- Stock transfer
- Cycle count
- Inventory adjustment
- Wave picking
- Route optimization
- Real-time tracking
- AI warehouse assistant

---

# 31. Future AI Integration

AI dapat digunakan sebagai interface tambahan.

Contoh:

User:

> "Tampilkan location yang hampir penuh."

System:

```text
AI
 ↓
Query inventory
 ↓
Find occupancy > 90%
 ↓
Highlight locations
```

3D warehouse kemudian otomatis melakukan highlight:

```text
🟡 A01-03
🔴 B02-01
🔴 B02-02
🟡 C01-04
```

Contoh lain:

> "Pindahkan SKU-00123 ke lokasi yang paling optimal."

AI dapat mempertimbangkan:

- available capacity
- product category
- movement frequency
- distance
- zone
- compatibility

Kemudian memberikan recommendation.

---

# 32. Design Principle

Aplikasi menggunakan prinsip:

> **Visual First, Data Driven.**

Artinya data WMS tetap menjadi sumber utama, tetapi visualisasi 3D menjadi cara utama untuk memahami data tersebut.

3D bukan sekadar dekorasi.

Setiap object pada scene harus memiliki hubungan dengan data warehouse.

```text
3D Object
    ↕
Business Entity
    ↕
Database
```

Contoh:

```text
Rack A01
    ↕
rack_id = RACK-A01
    ↕
database.racks
```

Location:

```text
A01-03
    ↕
location_id = LOC-003
    ↕
inventory
```

Dengan pendekatan tersebut, warehouse 3D dapat berkembang menjadi **interactive warehouse digital twin** di tahap selanjutnya.

---

# 33. Success Criteria

MVP dianggap berhasil apabila:

1. User dapat melihat warehouse dalam bentuk 3D.
2. User dapat melakukan orbit, zoom, dan pan.
3. User dapat melihat rack dan location.
4. User dapat mengetahui status location secara visual.
5. User dapat klik location.
6. Detail inventory dapat ditampilkan.
7. Pallet dapat ditampilkan pada location.
8. Movement dapat divisualisasikan.
9. Scene dapat berjalan dengan performa yang baik pada desktop.
10. Struktur aplikasi siap diintegrasikan dengan backend.
