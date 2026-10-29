# SCGP Water Management Dashboard

ติดตามสถานการณ์น้ำของสถานประกอบการ SCGP (24 พื้นที่ / 27 บริษัท) ตาม **7 Risk Trigger Point**
จากข้อมูลเปิดของหน่วยงานรัฐ — ใช้ประกอบการตัดสินใจ BCM

| # | Trigger | แหล่งข้อมูล |
|---|---------|-------------|
| 1 | ระดับน้ำเขื่อน (เทียบ Rule Curve ของ กฟผ.) | กรมชลประทาน, กฟผ. |
| 2 | น้ำไหลออก / ระบายจากเขื่อน | กรมชลประทาน, กฟผ. |
| 3 | ระดับท่าน้ำ (ม.รทก.) | สสน., กรมชลประทาน, กฟผ. |
| 4 | ระดับตลิ่ง | สสน. |
| 5 | ปริมาณน้ำฝน 24 ชม. | สสน. (รวมกรมอุตุฯ / ทน.) |
| 6 | ระดับท่อ / น้ำท่วมขัง | สำนักการระบายน้ำ กทม. |
| 7 | น้ำทะเลหนุน | สสน. (ป้อมพระจุลจอมเกล้า, ปากรอ) |

## โครงสร้าง

```
index.html               หน้า Dashboard (ไฟล์เดียว, สร้างจาก build.py)
api/water.js             Vercel Function: ดึง สสน. + กฟผ. แบบ real-time, เก็บประวัติลง Supabase
api/_lib/                transform.js + sites.json (คัดลอกจาก src/ และ data/ ตอน build)
src/                     template.html, app.js (หน้าเว็บ), transform.js (ใช้ร่วมกับ API)
data/                    sites.json (ที่ตั้ง SCGP), snapshot.json (ข้อมูลสำรอง), region.geo.json (ขอบเขตประเทศ)
supabase/migrations/     schema "water" (sites, site_contacts, criteria, snapshots)
```

## แก้ไขแล้ว deploy

```bash
python3 build.py      # สร้าง index.html ใหม่จาก src/ และ data/
git commit -am "..." && git push   # Vercel deploy อัตโนมัติ
```

- ปรับเกณฑ์: ตัวแปร `CRITERIA` ใน `src/app.js` (ค่าอ้างอิงเก็บไว้ในตาราง `water.criteria` ด้วย)
- ปรับพื้นที่/โซน/เขื่อน: `data/sites.json` (และตาราง `water.sites`)
- ชื่อ BCM Coordinator ไม่อยู่ใน repo นี้ เก็บในตาราง `water.site_contacts` (ไม่เปิดผ่าน API)

## Environment variables (Vercel)

| Key | ค่า |
|-----|-----|
| `SUPABASE_URL` | URL ของโปรเจกต์ Supabase |
| `SUPABASE_ANON_KEY` | publishable / anon key |
| `WATER_INGEST_KEY` | คีย์ที่ตรงกับ `water.app_secret` (ใช้บันทึก snapshot) |

## แหล่งข้อมูล
- คลังข้อมูลน้ำแห่งชาติ (สสน.) — https://www.thaiwater.net
- กรมชลประทาน — https://app.rid.go.th/reservoir/
- กฟผ. Water Intelligence Center — https://egatwater.egat.co.th
- สำนักการระบายน้ำ กทม. — https://weather.bangkok.go.th
