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
// const SHEET_NAME_USERS = 'Users'; // <-- DIHAPUS

function getTodayString() {
  return moment().tz(TIMEZONE).format('YYYY-MM-DD');
}

// --- (FUNGSI USER DIHAPUS DARI SINI) ---

// --- Fungsi Antrian ---

async function getTodayQueueData(branchName) {
  const today = getTodayString();
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${branchName}'!A2:J`,
    });
    const allRows = response.data.values || [];
    const todayRows = allRows.filter(row => row[7] === today); 
    return todayRows.map((row) => {
      const globalIndex = allRows.findIndex(allRow => 
        allRow[0] === row[0] && allRow[1] === row[1] && allRow[7] === row[7]
      );
      return {
        rowNumber: globalIndex + 2, 
        nama: row[0], no_wa: row[1], paket: row[2], tgl_lahir: row[3],
        jam_datang: row[4], alamat: row[5], note: row[6] || '',
        timestamp: row[7], no_antrian: parseInt(row[8]), status: row[9], 
      }
    });
  } catch (err) {
    console.error(`Error saat mengambil data antrian dari sheet '${branchName}':`, err.message);
    return [];
  }
}

/**
 * [DIRUBAH] Panggilan saveOrUpdateUser DIHAPUS
 */
async function addCustomer(nama, no_wa, paket, tgl_lahir, jam_datang, alamat, note, branchName) {
  // 1. (DIHAPUS) Panggilan ke saveOrUpdateUser dihapus
  
  // 2. Langsung simpan ke Antrian Harian
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

async function getFullQueue(branchName) {
  return await getTodayQueueData(branchName);
}

async function updateStatus(no_antrian, newStatus, branchName) {
  const todayQueue = await getTodayQueueData(branchName);
  const customer = todayQueue.find(cust => cust.no_antrian === no_antrian);
  if (!customer) { return; }
  const targetRow = customer.rowNumber;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${branchName}'!J${targetRow}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[newStatus]] },
  });
}

// --- Fungsi Pengaturan (Paket, Wording, Kategori) ---
// (Fungsi-fungsi ini TIDAK BERUBAH dari versi sebelumnya)

async function getWordingTemplates() {
  const defaultTemplates = [
    ['PANGGIL', 'Halo [nama], sekarang giliran Anda (No. [no_antrian]) jam [jam_datang].\nCatatan: [note]'],
    ['REMINDER', 'Halo [nama], antrian Anda (No. [no_antrian]) jam [jam_datang] sebentar lagi akan dipanggil.\nCatatan: [note]']
  ];
  const defaultObject = { PANGGIL: defaultTemplates[0][1], REMINDER: defaultTemplates[1][1] };
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME_WORDING}!A2:B`,
    });
    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log(`Sheet '${SHEET_NAME_WORDING}' kosong. Mengisi dengan data default...`);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME_WORDING}!A2:B3`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: defaultTemplates },
      });
      return defaultObject;
    }
    return rows.reduce((acc, row) => {
      if (row[0] && row[1]) acc[row[0]] = row[1];
      return acc;
    }, {});
  } catch (err) {
    console.error(`Error saat memproses Sheet '${SHEET_NAME_WORDING}': ${err.message}.`);
    return defaultObject;
  }
}

async function getCategoryList() {
  const defaultCategories = [['Potong Rambut'], ['Perawatan Rambut'], ['Perawatan Wajah']];
  const defaultArray = defaultCategories.map(c => c[0]);
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME_KATEGORI}!A2:A`,
    });
    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log(`Sheet '${SHEET_NAME_KATEGORI}' kosong. Mengisi dengan data default...`);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME_KATEGORI}!A2:A4`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: defaultCategories },
      });
      return defaultArray;
    }
    return rows.map(row => row[0]).filter(Boolean);
  } catch (err) {
    console.error(`Error saat memproses Sheet '${SHEET_NAME_KATEGORI}': ${err.message}.`);
    return defaultArray;
  }
}

async function addCategory(namaKategori) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME_KATEGORI}!A:A`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[namaKategori]] },
  });
}

async function deleteCategory(namaKategori) {
  const allCategories = await getCategoryList();
  const newCategories = allCategories.filter(c => c !== namaKategori);
  const newCategoryValues = newCategories.map(c => [c]);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME_KATEGORI}!A2:A`,
  });
  if (newCategoryValues.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME_KATEGORI}!A2`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: newCategoryValues },
    });
  }
}

async function getPackageList() {
  const defaultPackages = [
    ['Potong Reguler', '30 Menit', 'Cuci, potong, dan blow dry.', 'Potong Rambut'],
    ['Potong + Styling', '45 Menit', 'Potong plus styling khusus.', 'Potong Rambut'],
    ['Creambath Tradisional', '60 Menit', 'Termasuk pijat kepala dan punggung.', 'Perawatan Rambut'],
    ['Hair Mask', '45 Menit', 'Perawatan intensif rambut rusak.', 'Perawatan Rambut'],
    ['Facial Normal', '45 Menit', 'Pembersihan dan pencerahan.', 'Perawatan Wajah'],
    ['Facial Acne', '60 Menit', 'Perawatan khusus kulit berjerawat.', 'Perawatan Wajah']
  ];
  const defaultArrayObjects = defaultPackages.map(p => ({ nama: p[0], durasi: p[1], deskripsi: p[2], kategori: p[3] }));
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME_PAKET}!A2:D`,
    });
    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log(`Sheet '${SHEET_NAME_PAKET}' kosong. Mengisi dengan data default...`);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME_PAKET}!A2:D7`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: defaultPackages },
      });
      return defaultArrayObjects;
    }
    return rows.map(row => ({
      nama: row[0],
      durasi: row[1] || '-',
      deskripsi: row[2] || '-',
      kategori: row[3] || 'Lainnya'
    })).filter(p => p.nama);
  } catch (err) {
    console.error(`Error saat memproses Sheet '${SHEET_NAME_PAKET}': ${err.message}.`);
    return defaultArrayObjects;
  }
}

async function addPackage(nama, durasi, deskripsi, kategori) {
  const newRow = [[nama, durasi, deskripsi, kategori]];
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME_PAKET}!A:D`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: newRow },
  });
}

async function deletePackage(namaPaket) {
  const allPackages = await getPackageList();
  const newPackages = allPackages.filter(p => p.nama !== namaPaket);
  const newPackageValues = newPackages.map(p => [p.nama, p.durasi, p.deskripsi, p.kategori]);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME_PAKET}!A2:D`,
  });
  if (newPackageValues.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME_PAKET}!A2`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: newPackageValues },
    });
  }
}

async function updatePackage(oldName, newName, newDuration, newDesc, newKategori) {
  const allPackages = await getPackageList();
  const packageIndex = allPackages.findIndex(p => p.nama === oldName);
  if (packageIndex === -1) { return; }
  allPackages[packageIndex] = {
    nama: newName,
    durasi: newDuration,
    deskripsi: newDesc,
    kategori: newKategori
  };
  const newPackageValues = allPackages.map(p => [p.nama, p.durasi, p.deskripsi, p.kategori]);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME_PAKET}!A2:D`,
  });
  if (newPackageValues.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME_PAKET}!A2`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: newPackageValues },
    });
  }
}

// Update module.exports
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
  // (DIHAPUS) checkUserExists & verifyAndGetUser
};