const { google } = require('googleapis');
const moment = require('moment-timezone');

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TIMEZONE = 'Asia/Jakarta';

const SHEET_NAME_WORDING = 'Wording';
const SHEET_NAME_PAKET = 'Paket';
const SHEET_NAME_KATEGORI = 'Kategori';
const SHEET_NAME_USERS = 'Users';

function getTodayString() {
  return moment().tz(TIMEZONE).format('YYYY-MM-DD');
}

// =====================================
// [DIRUBAH] FUNGSI USER
// =====================================

/**
 * [DIRUBAH] Cek apakah user ada (AMAN - Tidak mengembalikan data)
 */
async function checkUserExists(phone) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME_USERS}!A2:A`, // Hanya baca kolom No_WA
    });
    const rows = response.data.values || [];
    const found = rows.some(row => row[0] === phone); // .some() lebih cepat
    return { found: found };
  } catch (err) {
    console.error('Error check user:', err.message);
    return { found: false };
  }
}

/**
 * [BARU] Verifikasi data user dan kembalikan datanya jika cocok
 */
async function verifyAndGetUser(phone, tgl_lahir) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME_USERS}!A2:D`, // Baca WA, Nama, Tgl, Alamat
    });
    const rows = response.data.values || [];
    
    // Cari baris yang No WA DAN Tgl Lahir-nya cocok
    const found = rows.find(row => row[0] === phone && row[2] === tgl_lahir);
    
    if (found) {
      return {
        success: true,
        nama: found[1],
        alamat: found[3]
      };
    }
    // Ditemukan tapi tgl lahir salah, atau tidak ditemukan
    return { success: false };
  } catch (err) {
    console.error('Error verify user:', err.message);
    return { success: false };
  }
}

/**
 * [TIDAK BERUBAH] Simpan atau Update User
 */
async function saveOrUpdateUser(no_wa, nama, tgl_lahir, alamat) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME_USERS}!A2:A`,
    });
    const rows = response.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === no_wa);
    
    if (rowIndex !== -1) {
      // UPDATE
      const targetRow = rowIndex + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME_USERS}!B${targetRow}:D${targetRow}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[nama, tgl_lahir, alamat]] },
      });
    } else {
      // INSERT
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME_USERS}!A:D`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[no_wa, nama, tgl_lahir, alamat]] },
      });
    }
  } catch (err) {
    console.error('Error save user:', err.message);
  }
}

// --- Fungsi Antrian (Lama) ---

async function addCustomer(nama, no_wa, paket, tgl_lahir, jam_datang, alamat, note, branchName) {
  // 1. Simpan ke Master User dulu
  await saveOrUpdateUser(no_wa, nama, tgl_lahir, alamat);
  
  // 2. Baru simpan ke Antrian Harian
  const today = getTodayString();
  const todayQueue = await getTodayQueueData(branchName); 
  const newQueueNumber = todayQueue.length + 1;
  const newStatus = "Menunggu";
  const newRow = [ nama, no_wa, paket, tgl_lahir, jam_datang, alamat, note, today, newQueueNumber, newStatus ];
  
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${branchName}'!A:J`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [newRow] },
  });
  return newQueueNumber;
}

async function getTodayQueueData(branchName) {
  // ... (Sama seperti kode sebelumnya, tidak perlu diubah)
  // (Pastikan fungsi ini membaca 10 kolom A2:J)
  const today = getTodayString();
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${branchName}'!A2:J` });
    const allRows = response.data.values || [];
    const todayRows = allRows.filter(row => row[7] === today); 
    return todayRows.map((row) => {
      const globalIndex = allRows.findIndex(allRow => allRow[0] === row[0] && allRow[1] === row[1] && allRow[7] === row[7]);
      return {
        rowNumber: globalIndex + 2, nama: row[0], no_wa: row[1], paket: row[2], tgl_lahir: row[3],
        jam_datang: row[4], alamat: row[5], note: row[6] || '',
        timestamp: row[7], no_antrian: parseInt(row[8]), status: row[9], 
      }
    });
  } catch (err) { return []; }
}
async function getFullQueue(branchName) {
  return await getTodayQueueData(branchName);
}
async function updateStatus(no_antrian, newStatus, branchName) {
  // ... (Sama seperti kode sebelumnya, tidak perlu diubah)
  const todayQueue = await getTodayQueueData(branchName);
  const customer = todayQueue.find(cust => cust.no_antrian === no_antrian);
  if (!customer) { return; }
  const targetRow = customer.rowNumber;
  await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `'${branchName}'!J${targetRow}`, valueInputOption: 'USER_ENTERED', resource: { values: [[newStatus]] } });
}

// --- Fungsi Pengaturan (Paket, Wording, Kategori) ---
// ... (SAMA SEPERTI SEBELUMNYA, TIDAK PERLU DIUBAH) ...
// (Pastikan semua fungsi helper (getWordingTemplates, getPackageList, dll) ada di sini)
async function getWordingTemplates() { /* ...copy kode lama... */ 
    const defaultTemplates = [['PANGGIL', 'Halo...'], ['REMINDER', 'Halo...']];
    const defaultObject = { PANGGIL: defaultTemplates[0][1], REMINDER: defaultTemplates[1][1] };
    try {
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME_WORDING}!A2:B` });
        const rows = response.data.values;
        if (!rows || rows.length === 0) return defaultObject; // (fallback)
        return rows.reduce((acc, row) => { if (row[0]) acc[row[0]] = row[1]; return acc; }, {});
    } catch (e) { return defaultObject; }
}
async function getCategoryList() { /* ...copy kode lama... */
    const defaultArr = [];
    try {
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME_KATEGORI}!A2:A` });
        return (response.data.values || []).map(r => r[0]).filter(Boolean);
    } catch(e) { return defaultArr; }
}
async function getPackageList() { /* ...copy kode lama... */ 
    const defaultArr = [];
    try {
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME_PAKET}!A2:D` });
        return (response.data.values || []).map(row => ({ nama: row[0], durasi: row[1]||'-', deskripsi: row[2]||'-', kategori: row[3]||'Lainnya' })).filter(p => p.nama);
    } catch (e) { return defaultArr; }
}
async function addCategory(n) { /* ...copy kode lama... */ await sheets.spreadsheets.values.append({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME_KATEGORI}!A:A`, valueInputOption: 'USER_ENTERED', resource: { values: [[n]] } }); }
async function deleteCategory(n) { /* ...copy kode lama... */ } // (Gunakan kode dari jawaban sebelumnya)
async function updateWording(p, r) { /* ...copy kode lama... */ await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME_WORDING}!A2:B3`, valueInputOption: 'USER_ENTERED', resource: { values: [['PANGGIL', p], ['REMINDER', r]] } }); }
async function addPackage(n, d, de, k) { /* ...copy kode lama... */ await sheets.spreadsheets.values.append({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME_PAKET}!A:D`, valueInputOption: 'USER_ENTERED', resource: { values: [[n,d,de,k]] } }); }
async function deletePackage(n) { /* ...copy kode lama... */ } // (Gunakan kode dari jawaban sebelumnya)
async function updatePackage(oldN, newN, d, de, k) { /* ...copy kode lama... */ } // (Gunakan kode dari jawaban sebelumnya)


module.exports = {
  addCustomer,
  getFullQueue,
  updateStatus,
  getWordingTemplates,
  getPackageList,
  getCategoryList,
  addCategory,
  deleteCategory,
  updateWording,
  addPackage,
  deletePackage,
  updatePackage,
  checkUserExists, // (BARU - WAJIB DIEKSPOR)
  verifyAndGetUser, // (BARU - WAJIB DIEKSPOR)
};