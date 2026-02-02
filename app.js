import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, getDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove, onSnapshot, query, orderBy, where, limit, increment, runTransaction } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// --- КОНФИГУРАЦИЯ (Оставь как есть или вставь свою) ---
const firebaseConfig = {
    apiKey: "AIzaSyBCcBSZx6kAFGwTscJlfDuiQILGZDaVN4g",
    authDomain: "mysocnet-34ee9.firebaseapp.com",
    projectId: "mysocnet-34ee9",
    storageBucket: "mysocnet-34ee9.firebasestorage.app",
    messagingSenderId: "82449086862",
    appId: "1:82449086862:web:e77a61b33a54be97a00cdf",
    measurementId: "G-4Z2SMZS5N4"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

// --- НАСТРОЙКИ ИГРЫ ---
const CASE_PRICE = 100; // Цена кейса
const ITEMS_DB = {
    legendary: ['🤡'], // 0.9%
    epic: ['👑', '🦄', '🐲', '👽'], // 2%
    rare: ['😳', '🥸', '💀', '🤔', '😶‍🌫️', '😍'], // 15%
    common: ['💩', '👻', '🤖', '👾', '🎃', '😺', '🙉', '🦊', '🌚', '🍕', '🍔', '🍟', '🌭', '🍿', '🧂', '🥓', '🥚', '🍳', '🧇', '🥞', '🧈', '🍞', '🥐', '🥨', '🥯', '🥖', '🧀', '🥗', 'pita', '🥪', '🌮', '🌯', '🥫', '🍱', '🍘', '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍣', '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍯'] // Остальное
};

const ICONS = {
    like: '<svg class="icon" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    comment: '<svg class="icon" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    share: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>',
    trash: '<svg class="icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    verify: '<svg class="verified-badge" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
    lock: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
};

// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
let currentUser = null;
let listeners = {};
let tempImg = null;
let tempChatImg = null;
let tempAv = null;
let curChat = null;
let curChatAvatar = '';
let curPost = null;
let captchaAns = 0;
let lastPostTime = 0;
let activeChatUnsub = null;
let forbiddenWords = [];
let activeGroupId = null;
let mediaRec = null;
let audioChunks = [];

// --- УТИЛИТЫ ---
const compress = (file, cb) => {
    const r = new FileReader(); r.readAsDataURL(file);
    r.onload = e => {
        const i = new Image(); i.src = e.target.result;
        i.onload = () => {
            const c = document.createElement('canvas');
            const max = 800; let w=i.width, h=i.height;
            if(w>h){if(w>max){h*=max/w;w=max}}else{if(h>max){w*=max/h;h=max}}
            c.width=w; c.height=h; c.getContext('2d').drawImage(i,0,0,w,h);
            cb(c.toDataURL('image/jpeg', 0.8));
        }
    }
};

const getAv = (u, sz, addFrame=false) => {
    let src = u.avatar || u.authorAvatar || 'https://via.placeholder.com/80';
    // Проверка на редкие рамки (если включена и есть инвентарь)
    let frameClass = '';
    if(addFrame && u.inventory) {
        // Если есть легендарка - золотая рамка
        if(u.inventory.some(i => i.rarity === 'legendary')) frameClass = 'frame-legendary';
        else if(u.inventory.some(i => i.rarity === 'epic')) frameClass = 'frame-epic';
    }
    return `<img src="${src}" class="avatar ${sz} ${frameClass}">`;
};

const parseTime = (ts) => new Date(ts).toLocaleDateString();

// iOS Emojis Parser
const iosMoji = () => { try { twemoji.parse(document.body); } catch(e){} };

// --- UI CONTROLLER ---
window.ui = {
    nav: (v, p) => {
        if(activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; }
        if(v === 'profile' && !p) { if(currentUser) p = currentUser.username; else return; }
        if(v !== 'profile') activeGroupId = null;

        document.querySelectorAll('.view').forEach(e=>e.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(e=>e.classList.remove('active'));
        
        const el = document.getElementById('view-'+(v==='admin'?'admin':v));
        if(el) el.classList.add('active');
        
        // Маппинг кнопок навигации
        const map = {'feed':0, 'market':1, 'search':2, 'groups':3, 'chats':4, 'notifs':5, 'rich':6, 'profile':7, 'settings':8};
        if(map[v]!==undefined && document.querySelectorAll('.nav-item')[map[v]]) 
            document.querySelectorAll('.nav-item')[map[v]].classList.add('active');

        if(v==='chat-room') {
            document.getElementById('view-chat-room').style.display = 'flex';
            document.querySelector('.sidebar').style.display = 'none'; // Скрыть меню на мобилках
        } else {
            document.getElementById('view-chat-room').style.display = 'none';
            document.querySelector('.sidebar').style.display = 'flex';
        }
        
        // Логика загрузки
        if(v==='feed') app.loadFeed();
        if(v==='chats') app.loadChats();
        if(v==='groups') app.loadGroups();
        if(v==='notifs') app.listenNotifs();
        if(v==='market') market.tab('cases');
        if(v==='rich') app.loadRich();
        if(v==='profile') app.loadProfile(p);
        if(v==='chat-room') app.loadChatRoom(p);
        if(v==='admin') { admin.tab('users'); admin.stats(); }
        if(v==='settings') {
            document.getElementById('settings-bal').innerText = currentUser.balance || 0;
            if(currentUser.isAdmin) document.getElementById('settings-admin-btn').classList.remove('hidden');
        }
        
        iosMoji();
    },
    toggleAuth: m => {
        document.getElementById('login-box').classList.toggle('hidden', m!=='login');
        document.getElementById('reg-box').classList.toggle('hidden', m!=='reg');
        if(m==='reg') app.genCaptcha();
    },
    togglePass: id => {
        const el = document.getElementById(id);
        el.type = el.type==='password'?'text':'password';
    },
    closeModals: () => {
        document.querySelectorAll('.modal-overlay').forEach(e=>e.style.display='none');
        document.getElementById('case-result').classList.add('hidden');
        document.getElementById('case-spinner').classList.remove('hidden');
        document.getElementById('case-close-btn').classList.add('hidden');
    },
    theme: () => {
        const d = document.getElementById('theme-switch').checked;
        document.documentElement.setAttribute('data-theme', d?'dark':'');
        localStorage.setItem('theme', d?'dark':'');
    },
    setTab: (t, btn) => {
        document.querySelectorAll('.set-page').forEach(e=>e.classList.add('hidden'));
        document.getElementById('set-'+t).classList.remove('hidden');
        btn.parentElement.querySelectorAll('.tab').forEach(e=>e.classList.remove('active'));
        btn.classList.add('active');
    }
};

// --- ОСНОВНАЯ ЛОГИКА ---
window.app = {
    init: async () => {
        if(localStorage.getItem('theme')==='dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
            document.getElementById('theme-switch').checked = true;
        }
        try {
            const u = localStorage.getItem('user');
            if(u) {
                const s = await getDoc(doc(db, 'users', u));
                if(s.exists()) {
                    currentUser = s.data();
                    // Миграция данных (если старый аккаунт)
                    currentUser.blocked = currentUser.blocked || [];
                    currentUser.blockedBy = currentUser.blockedBy || [];
                    currentUser.pinnedChats = currentUser.pinnedChats || [];
                    currentUser.groups = currentUser.groups || [];
                    currentUser.balance = currentUser.balance || 0;
                    currentUser.inventory = currentUser.inventory || [];
                    
                    if(currentUser.isDeleted) throw new Error('Deleted');
                    if(currentUser.isBanned) throw new Error('Banned');
                    
                    const conf = await getDoc(doc(db, 'system', 'config'));
                    if(conf.exists()) forbiddenWords = conf.data().words || [];

                    document.getElementById('auth-screen').style.display='none';
                    document.getElementById('app-screen').style.display='block';
                    if(currentUser.isAdmin) document.getElementById('nav-admin').classList.remove('hidden');
                    
                    app.checkStatuses(); // Проверка новых ачивок
                    ui.nav('feed');
                } else throw new Error('No User');
            } else throw new Error('No Local User');
        } catch(e) {
            if(e.message === 'Banned') alert('Ваш аккаунт заблокирован.');
            if(e.message === 'Deleted') alert('Аккаунт удален.');
            localStorage.clear();
            ui.toggleAuth('login');
        } finally {
            setTimeout(() => { document.getElementById('splash').style.display='none'; }, 500);
        }
    },

    genCaptcha: () => {
        const a=Math.floor(Math.random()*10), b=Math.floor(Math.random()*10);
        captchaAns = a+b;
        document.getElementById('captcha-task').innerText = `${a} + ${b}`;
    },

    register: async () => {
        const u = document.getElementById('reg-user').value.toLowerCase().trim();
        const n = document.getElementById('reg-name').value.trim();
        const p1 = document.getElementById('reg-pass').value;
        const p2 = document.getElementById('reg-pass2').value;
        const c = parseInt(document.getElementById('reg-captcha').value);
        
        if(!u || !n || !p1) return alert('Заполните поля');
        if(p1!==p2) return alert('Пароли не совпадают');
        if(c!==captchaAns) return alert('Капча неверна');
        
        try {
            const r = doc(db, 'users', u);
            if((await getDoc(r)).exists()) return alert('Ник занят');
            
            // Создание пользователя
            const newUser = { 
                username: u, 
                name: n, 
                password: p1, 
                followers: [], 
                following: [], 
                blocked: [], 
                isAdmin: u==='haskin', 
                isBanned: false, 
                isMuted: false, 
                requests: [], 
                groups: [], 
                bio: '', 
                status: 'Новичок', 
                avatar: '', 
                createdAt: Date.now(),
                balance: 10, // Бонус за регистрацию
                inventory: [] 
            };
            
            await setDoc(r, newUser);
            alert('Готово! Войдите.'); ui.toggleAuth('login');
        } catch(e) { alert('Ошибка регистрации'); }
    },

    login: async () => {
        const u = document.getElementById('login-user').value.toLowerCase().trim();
        const p = document.getElementById('login-pass').value;
        const s = await getDoc(doc(db, 'users', u));
        if(s.exists() && s.data().password === p) {
            if(s.data().isBanned) return alert('Бан');
            localStorage.setItem('user', u);
            location.reload();
        } else alert('Неверно');
    },
    logout: () => { localStorage.clear(); location.reload(); },

    checkContent: (txt) => {
        if(!txt) return true;
        const lower = txt.toLowerCase();
        for(let w of forbiddenWords) {
            if(lower.includes(w.toLowerCase())) { alert(`Слово "${w}" запрещено`); return false; }
        }
        return true;
    },
    
    // --- ПОСТЫ ---
    openCreatePost: () => {
        document.getElementById('group-post-hint').style.display = activeGroupId ? 'block' : 'none';
        if(activeGroupId) document.getElementById('group-post-hint').innerText = "В группу: " + activeGroupId;
        document.getElementById('create-post-modal').style.display='flex';
    },

    createPost: async () => {
        if(currentUser.isMuted) return alert("Вы замьючены!");
        if(Date.now()-lastPostTime < 5000) return alert('Не спеши!');
        const txt = document.getElementById('post-text').value.trim();
        if(!app.checkContent(txt)) return;
        if(!txt && !tempImg) return;
        
        const p = { 
            author: currentUser.username, 
            name: currentUser.name, 
            content: txt, 
            image: tempImg || null, 
            likes: [], 
            createdAt: Date.now(), 
            verified: currentUser.isVerified || false, 
            status: currentUser.status || '', 
            avatar: currentUser.avatar || '',
            authorInventory: currentUser.inventory || [] // Для рамок в посте
        };
        if(activeGroupId) p.groupId = activeGroupId;

        await addDoc(collection(db, 'posts'), p);
        
        // Майнинг (+5 монет)
        await updateDoc(doc(db, 'users', currentUser.username), { balance: increment(5) });
        currentUser.balance += 5;

        lastPostTime = Date.now();
        document.getElementById('post-text').value='';
        app.clearImg(); ui.closeModals();
        
        if(activeGroupId) app.loadProfile(activeGroupId);
        else app.checkAchievs(); // Проверка на "Писателя"
    },

    loadFeed: async () => {
        const c = document.getElementById('feed-content'); c.innerHTML = '';
        
        // Топ дня
        const yesterday = Date.now() - 86400000;
        const qTop = query(collection(db, 'posts'), where('createdAt', '>', yesterday), orderBy('createdAt', 'desc')); 
        const snaps = await getDocs(qTop);
        let topPost = null; let maxLikes = -1;
        snaps.forEach(d => { const p = d.data(); p.id = d.id; if(!p.groupId && p.likes && p.likes.length > maxLikes) { maxLikes = p.likes.length; topPost = p; } });
        if(topPost && maxLikes > 0) c.innerHTML += app.renderPost(topPost, true);
        
        // Обычная лента
        if(listeners.feed) listeners.feed();
        const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));
        listeners.feed = onSnapshot(q, s => {
            const topHtml = topPost && maxLikes > 0 ? app.renderPost(topPost, true) : '';
            let html = topHtml;
            s.forEach(d => {
                const p = d.data(); p.id = d.id;
                if(p.groupId) return;
                if(currentUser.blocked.includes(p.author)) return;
                if(topPost && p.id === topPost.id) return;
                html += app.renderPost(p);
            });
            c.innerHTML = html;
            iosMoji();
        });
    },

    renderPost: (p, isTop=false) => {
        const likes = p.likes || [];
        const isLiked = likes.includes(currentUser.username);
        const isMine = p.author === currentUser.username;
        const verified = p.verified ? ICONS.verify : '';
        const status = p.status ? `<span class="status-pill">${p.status}</span>` : '';
        
        // Имитация объекта юзера для аватарки с рамкой
        const fakeUser = { avatar: p.avatar, authorAvatar: p.authorAvatar, inventory: p.authorInventory };

        return `<div class="card ${isTop?'top-post-banner':''}">
            ${isTop ? '<div class="top-label">👑 ТОП ДНЯ</div>' : ''}
            <div class="post-header" onclick="ui.nav('profile','${p.author}')">
                ${getAv(fakeUser, 'av-40', true)}
                <div><div style="font-weight:bold; display:flex; align-items:center;">${p.name||p.author} ${verified} ${status}</div>
                <div style="font-size:12px; color:gray">@${p.author} • ${parseTime(p.createdAt)}</div></div>
            </div>
            <div style="white-space:pre-wrap">${p.content}</div>
            ${p.image ? `<img src="${p.image}" class="post-img">` : ''}
            <div class="post-actions">
                <div class="act-btn ${isLiked?'liked':''}" onclick="app.like('${p.id}', '${p.author}')">${ICONS.like} ${likes.length}</div>
                <div class="act-btn" onclick="app.openComs('${p.id}', '${p.author}')">${ICONS.comment}</div>
                ${isMine || currentUser.isAdmin ? `<div class="act-btn" style="margin-left:auto; color:red" onclick="app.delPost('${p.id}')">${ICONS.trash}</div>` : ''}
            </div>
        </div>`;
    },

    // --- ПРОФИЛЬ ---
    loadProfile: async (u) => {
        const c = document.getElementById('profile-head');
        const pc = document.getElementById('profile-posts');
        c.innerHTML = '<div class="info-box">Загрузка...</div>';
        pc.innerHTML = '';
        activeGroupId = null;

        // Блокировка профиля Системы
        if (u === 'System') {
            c.innerHTML = `<div class="card center-content"><h2>🤖 System</h2><p>Служебный аккаунт</p></div>`;
            pc.innerHTML = '';
            return;
        }

        const s = await getDoc(doc(db, 'users', u));
        if(s.exists()) { 
            const user = s.data();
            const isMe = u === currentUser.username;
            const isFollow = currentUser.following.includes(u);
            const isBlocked = currentUser.blocked.includes(u);
            const isClosed = user.isPrivate && !isMe && !isFollow;
            
            // Кнопки действий
            let btn = '';
            if(isMe) btn = `<button class="action-btn sm-btn" onclick="ui.nav('settings')">Редактировать</button>`;
            else {
                if(isBlocked) btn = `<button class="action-btn btn-sec sm-btn" onclick="app.blockUser('${u}', false)">Разблокировать</button>`;
                else {
                    if(isFollow) btn = `<button class="action-btn btn-sec sm-btn" onclick="app.follow('${u}')">Отписаться</button> <button class="action-btn sm-btn" onclick="ui.nav('chat-room','${u}')">Чат</button>`;
                    else if (user.isPrivate) {
                        const sent = user.requests && user.requests.includes(currentUser.username);
                        btn = `<button class="action-btn sm-btn" onclick="app.reqFollow('${u}')">${sent?'Запрос отправлен':'🔒 Подписаться'}</button>`;
                    } else btn = `<button class="action-btn sm-btn" onclick="app.follow('${u}')">Подписаться</button>`;
                    
                    btn += `<br><button class="action-btn btn-danger sm-btn mt-10" onclick="app.blockUser('${u}', true)">Заблокировать</button>`;
                }
            }

            // Рендер инвентаря в профиле (редкие смайлы)
            let rareShowcase = '';
            if(user.inventory && user.inventory.length > 0) {
                const rares = user.inventory.filter(i => ['legendary', 'epic'].includes(i.rarity)).slice(0, 5);
                if(rares.length > 0) {
                    rareShowcase = `<div style="margin: 10px 0; font-size: 20px;">${rares.map(i => i.emoji).join(' ')}</div>`;
                }
            }

            c.innerHTML = `<div class="card center-content">
                ${getAv(user, 'av-80', true)}
                <h2 style="margin:5px 0">${user.name} ${user.isVerified?ICONS.verify:''}</h2>
                <div style="color:gray">@${user.username} ${user.status?`• <span class="status-pill">${user.status}</span>`:''}</div>
                <p>${user.bio||''}</p>
                ${rareShowcase}
                <div style="display:flex; justify-content:center; gap:20px; margin:10px 0;">
                    <b>${user.followers.length} <span style="font-weight:normal; color:gray">подп.</span></b>
                    <b>${user.following.length} <span style="font-weight:normal; color:gray">подписки</span></b>
                </div>${btn}</div>`;

            if(isClosed || isBlocked) {
                pc.innerHTML = `<div class="info-box">${ICONS.lock} Доступ ограничен</div>`;
            } else {
                const q = query(collection(db, 'posts'), where('author', '==', u));
                const ps = await getDocs(q);
                let postsArr = [];
                ps.forEach(d => postsArr.push({...d.data(), id:d.id}));
                postsArr.sort((a,b) => b.createdAt - a.createdAt);
                
                if(postsArr.length === 0) pc.innerHTML = '<div class="info-box">Нет постов</div>';
                else postsArr.forEach(p => { if(!p.groupId) pc.innerHTML += app.renderPost(p); });
            }
        } else {
            // ГРУППЫ
            const g = await getDoc(doc(db, 'groups', u));
            if(g.exists()) {
                activeGroupId = u; 
                const group = g.data();
                const isMem = group.members.includes(currentUser.username);
                const isOwner = group.owner === currentUser.username;
                const ownerControls = isOwner ? `<div style="display:flex; gap:5px; justify-content:center; margin-top:10px;"><button class="action-btn btn-sec sm-btn" onclick="app.editGroup('${u}')">✏️</button><button class="action-btn btn-danger sm-btn" onclick="app.deleteGroup('${u}')">🗑️</button></div>` : '';
                
                c.innerHTML = `<div class="card center-content"><div class="avatar av-80" style="background:${varColor(group.name)}; display:inline-flex; align-items:center; justify-content:center; font-size:30px; color:white;">${group.avatar ? `<img src="${group.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : group.name[0]}</div><h2>${group.name}</h2><p>${group.desc}</p><p style="color:gray">${group.members.length} участников</p>${isMem ? `<button class="action-btn btn-sec" onclick="app.joinGroup('${u}', false)">Выйти</button>` : `<button class="action-btn" onclick="app.joinGroup('${u}', true)">Вступить</button>`}${ownerControls}</div>`;
                 
                const q = query(collection(db, 'posts'), where('groupId', '==', u));
                const ps = await getDocs(q);
                let postsArr = [];
                ps.forEach(d => postsArr.push({...d.data(), id:d.id}));
                postsArr.sort((a,b) => b.createdAt - a.createdAt);

                if(isMem) pc.innerHTML = `<button class="action-btn full-width mb-20" onclick="app.openCreatePost()">Написать в группу</button>`;
                postsArr.forEach(p => pc.innerHTML += app.renderPost(p));
            } else c.innerHTML = '<div class="info-box">Не найдено</div>';
        }
        iosMoji();
    },

    // --- ЧАТЫ ---
    loadChats: async () => {
        const c = document.getElementById('chats-list'); c.innerHTML='<div class="info-box">Обновление...</div>';
        const pinned = currentUser.pinnedChats || [];
        const friends = currentUser.following; 
        
        let chatsData = [];
        // Проверяем подписки (взаимные)
        for(const f of friends) {
             const u = await getDoc(doc(db, 'users', f));
             if(!u.exists()) continue;
             const ud = u.data();
             if(ud.following.includes(currentUser.username)) {
                 const chatId = [currentUser.username, f].sort().join('_');
                 const meta = await getDoc(doc(db, 'chats', chatId));
                 const lastMsg = meta.exists() ? (meta.data().lastMessage || 'Написать...') : 'Написать...';
                 const lastTime = meta.exists() ? (meta.data().lastTime || 0) : 0;
                 chatsData.push({ id: f, user: ud, lastMsg, lastTime });
             }
        }
        // Добавляем системный чат если были варны
        if(listeners.sysChat) {
             const sysId = [currentUser.username, 'System'].sort().join('_');
             const sysMeta = await getDoc(doc(db, 'chats', sysId));
             if(sysMeta.exists()) {
                 chatsData.push({ id: 'System', user: {name: 'System', avatar: '', status:''}, lastMsg: sysMeta.data().lastMessage, lastTime: sysMeta.data().lastTime });
             }
        }

        chatsData.sort((a,b) => {
            const aPin = pinned.includes(a.id); const bPin = pinned.includes(b.id);
            if(aPin && !bPin) return -1; if(!aPin && bPin) return 1;
            return b.lastTime - a.lastTime;
        });

        c.innerHTML = '';
        if(chatsData.length===0) c.innerHTML='<div class="info-box">Подпишитесь взаимно, чтобы начать чат</div>';
        
        chatsData.forEach(ch => {
            const isPin = pinned.includes(ch.id);
            const isSys = ch.id === 'System';
            c.innerHTML += `<div class="card user-row ${isPin?'pinned-chat':''}" style="justify-content:space-between">
                <div class="user-row" onclick="ui.nav('chat-room','${ch.id}')" style="flex:1">
                    ${isSys ? '<div class="avatar av-40" style="background:#eee">🤖</div>' : getAv(ch.user, 'av-40')} 
                    <div><b>${ch.user.name} ${isPin?'📌':''}</b><div style="font-size:12px; color:gray; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; max-width:150px;">${ch.lastMsg}</div></div>
                </div>
                ${!isSys ? `<button class="action-btn btn-sec sm-btn" onclick="app.pinChat('${ch.id}')">${isPin?'❌':'📌'}</button>` : ''}
            </div>`;
        });
        iosMoji();
    },
    
    pinChat: async (target) => {
        if(currentUser.pinnedChats.includes(target)) await updateDoc(doc(db, 'users', currentUser.username), { pinnedChats: arrayRemove(target) });
        else await updateDoc(doc(db, 'users', currentUser.username), { pinnedChats: arrayUnion(target) });
        app.loadChats(); // Обновляем без перезагрузки
    },

    loadChatRoom: async (partner) => {
        document.getElementById('chat-title').innerText = partner;
        curChat = partner;
        
        // Фикс Системы
        if (partner === 'System') {
             document.getElementById('chat-bar').style.display = 'none';
             curChatAvatar = '';
        } else {
             document.getElementById('chat-bar').style.display = 'flex';
             const u = await getDoc(doc(db, 'users', partner));
             curChatAvatar = u.exists() ? (u.data().avatar || '') : '';
        }

        const chatId = [currentUser.username, partner].sort().join('_');
        const c = document.getElementById('msg-container');
        if(activeChatUnsub) activeChatUnsub();
        
        const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('time', 'asc'), limit(50));
        activeChatUnsub = onSnapshot(q, s => {
            c.innerHTML = '';
            s.forEach(d => {
                const m = d.data();
                const isMe = m.from === currentUser.username;
                const isSys = m.from === 'System';
                let html = '';
                
                let content = m.text;
                if(m.image) content = `<img src="${m.image}" class="chat-img" onclick="window.open('${m.image}')">`;
                if(m.audio) content = `<audio controls src="${m.audio}"></audio>`;

                if(isSys) html = `<div class="msg system">${content}</div>`;
                else {
                    const delBtn = isMe ? `<span class="msg-del" onclick="app.delMsg('${d.id}','${chatId}')">×</span>` : '';
                    html = `<div class="msg-row ${isMe?'me':'other'}">${!isMe ? `<img src="${curChatAvatar||'https://via.placeholder.com/20'}" class="avatar av-20">` : ''}<div class="msg ${isMe?'me':'other'}">${content}</div>${delBtn}</div>`;
                }
                c.innerHTML += html;
            });
            c.scrollTop = c.scrollHeight;
            iosMoji();
        });
    },

    sendMsg: async () => {
        const txt = document.getElementById('msg-input').value.trim();
        if(!txt && !tempChatImg) return;
        if(currentUser.blocked.includes(curChat)) return alert("Разблокируйте сначала");
        
        const chatId = [currentUser.username, curChat].sort().join('_');
        const msgData = { from: currentUser.username, time: Date.now() };
        if(txt) msgData.text = txt;
        if(tempChatImg) { msgData.image = tempChatImg; msgData.text = '📷 Фото'; }

        await addDoc(collection(db, 'chats', chatId, 'messages'), msgData);
        await setDoc(doc(db, 'chats', chatId), { lastMessage: msgData.text, lastTime: Date.now() }, { merge: true });
        
        document.getElementById('msg-input').value = '';
        tempChatImg = null;
    },

    // --- АВТО-СТАТУСЫ (Ачивки) ---
    checkStatuses: async () => {
        let newStatus = currentUser.status;
        const bal = currentUser.balance;
        const inv = currentUser.inventory ? currentUser.inventory.length : 0;
        
        if(bal > 10000) newStatus = 'Магнат';
        else if(bal > 1000) newStatus = 'Богач';
        else if(inv >= 10) newStatus = 'Коллекционер';
        else if(currentUser.followers.length > 50) newStatus = 'Хайпбист';
        
        // Если статус поменялся, обновляем
        if(newStatus !== currentUser.status && newStatus !== 'Admin') {
            await updateDoc(doc(db, 'users', currentUser.username), { status: newStatus });
            currentUser.status = newStatus;
        }
    },
    
    // --- ПРОЧЕЕ ---
    handleImg: el => { if(el.files[0]) compress(el.files[0], d=>{ tempImg=d; document.getElementById('preview-img-el').src=d; document.getElementById('post-img-preview').classList.remove('hidden'); }) },
    clearImg: () => { tempImg=null; document.getElementById('post-img-preview').classList.add('hidden'); },
    handleAvatar: (el, isGroup=false) => { if(el.files[0]) compress(el.files[0], d=>{ tempAv=d; if(isGroup) document.getElementById('edit-group-av-prev').src = d; }) },
    handleChatImg: el => { if(el.files[0]) compress(el.files[0], d => { tempChatImg = d; app.sendMsg(); }); },
    
    saveProfile: async () => { const n = document.getElementById('edit-name').value; const b = document.getElementById('edit-bio').value; const s = document.getElementById('edit-status').value; const upd = { name:n, bio:b, status:s }; if(tempAv) upd.avatar = tempAv; await updateDoc(doc(db, 'users', currentUser.username), upd); location.reload(); },
    togglePrivate: async () => { const v = document.getElementById('private-switch').checked; await updateDoc(doc(db, 'users', currentUser.username), { isPrivate: v }); },
    changePass: async () => { const p1 = document.getElementById('ch-pass').value; const p2 = document.getElementById('ch-pass2').value; if(!p1) return; if(p1 !== p2) return alert("Пароли не совпадают!"); await updateDoc(doc(db, 'users', currentUser.username), { password: p1 }); alert('Пароль изменен'); },
    
    // --- БАЗОВЫЕ ФУНКЦИИ ---
    search: async (v) => { if(!v) return; v = v.toLowerCase(); const q = query(collection(db, 'users'), where('username', '>=', v), limit(5)); const s = await getDocs(q); const c = document.getElementById('search-res'); c.innerHTML=''; s.forEach(d => { const u = d.data(); c.innerHTML += `<div class="card user-row" onclick="ui.nav('profile','${u.username}')">${getAv(u,'av-40')} <b>${u.name}</b></div>`; }); iosMoji(); },
    notify: async (to, type, txt) => { if(to === currentUser.username) return; await addDoc(collection(db, 'users', to, 'notifications'), { type, text: txt, from: currentUser.username, time: Date.now(), read: false }); },
    listenNotifs: () => { const q = query(collection(db, 'users', currentUser.username, 'notifications'), orderBy('time', 'desc'), limit(20)); onSnapshot(q, s => { let n = 0; s.forEach(d => { if(!d.data().read) n++ }); document.getElementById('notif-badge').style.display = n?'block':'none'; if(document.getElementById('view-notifs').classList.contains('active')) { const c = document.getElementById('notifs-list'); c.innerHTML=''; s.forEach(d => { const x = d.data(); let act = ''; if(x.type === 'req') act = `<button class="action-btn sm-btn" onclick="app.acceptReq('${x.from}')">Принять</button>`; c.innerHTML += `<div class="card user-row" onclick="ui.nav('profile','${x.from}')">${ICONS.lock} <div><b>@${x.from}</b> ${x.text}</div> ${act}</div>`; }); iosMoji(); } }); },
    reqVerify: async () => { await addDoc(collection(db,'system','verifications','requests'), { username: currentUser.username, realname: document.getElementById('v-real').value, reason: document.getElementById('v-reason').value, status: 'pending' }); alert('Заявка отправлена'); ui.closeModals(); },
    
    // AUDIO
    toggleRecord: async () => {
        if(mediaRec && mediaRec.state === 'recording') {
            mediaRec.stop();
            document.getElementById('mic-btn').classList.remove('rec-active');
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRec = new MediaRecorder(stream);
                audioChunks = [];
                mediaRec.ondataavailable = e => audioChunks.push(e.data);
                mediaRec.onstop = () => {
                    const blob = new Blob(audioChunks, { type: 'audio/webm' });
                    const reader = new FileReader();
                    reader.readAsDataURL(blob);
                    reader.onloadend = () => { app.sendAudio(reader.result); }
                    stream.getTracks().forEach(track => track.stop());
                };
                mediaRec.start();
                document.getElementById('mic-btn').classList.add('rec-active');
                setTimeout(() => { if(mediaRec && mediaRec.state==='recording') app.toggleRecord(); }, 15000);
            } catch(e) { alert('Нет микрофона'); }
        }
    },
    sendAudio: async (data) => {
        const chatId = [currentUser.username, curChat].sort().join('_');
        await addDoc(collection(db, 'chats', chatId, 'messages'), { from: currentUser.username, audio: data, text: '🎤 Голосовое', time: Date.now() });
        await setDoc(doc(db, 'chats', chatId), { lastMessage: '🎤 Голосовое', lastTime: Date.now() }, { merge: true });
    },

    // --- LEADERBOARD ---
    loadRich: async () => {
        const c = document.getElementById('rich-list'); c.innerHTML = '<div class="info-box">Загрузка топа...</div>';
        const q = query(collection(db, 'users'), orderBy('balance', 'desc'), limit(20));
        const s = await getDocs(q);
        c.innerHTML = '';
        let i = 1;
        s.forEach(d => {
            const u = d.data();
            const medal = i===1?'🥇':(i===2?'🥈':(i===3?'🥉':''));
            c.innerHTML += `<div class="card user-row" onclick="ui.nav('profile','${u.username}')">
                <div style="font-size:1.2em; width:30px;">${medal || i+'.'}</div>
                ${getAv(u, 'av-40')}
                <div style="flex:1;"><b>${u.name}</b><br>@${u.username}</div>
                <b style="color:var(--gold-color)">${u.balance||0} HC</b>
            </div>`;
            i++;
        });
        iosMoji();
    },

    // --- GROUP & ACTIONS STUBS (Compact) ---
    like: async (pid, auth) => { const r = doc(db,'posts',pid); const p=(await getDoc(r)).data(); if(p.likes.includes(currentUser.username)) await updateDoc(r,{likes:arrayRemove(currentUser.username)}); else { await updateDoc(r,{likes:arrayUnion(currentUser.username)}); await updateDoc(doc(db,'users',auth),{balance:increment(1)}); app.notify(auth,'like','оценил пост (+1 HC)'); } },
    follow: async (u) => { if(currentUser.blocked.includes(u)) return; const me=doc(db,'users',currentUser.username); const him=doc(db,'users',u); if(currentUser.following.includes(u)) { await updateDoc(me,{following:arrayRemove(u)}); await updateDoc(him,{followers:arrayRemove(currentUser.username)}); currentUser.following = currentUser.following.filter(x=>x!==u); } else { await updateDoc(me,{following:arrayUnion(u)}); await updateDoc(him,{followers:arrayUnion(currentUser.username)}); currentUser.following.push(u); app.notify(u,'sub','подписался'); } ui.nav('profile',u); },
    reqFollow: async (u) => { await updateDoc(doc(db,'users',u),{requests:arrayUnion(currentUser.username)}); app.notify(u,'req','хочет подписаться'); alert('Отправлено'); },
    acceptReq: async (u) => { await updateDoc(doc(db,'users',currentUser.username),{requests:arrayRemove(u),followers:arrayUnion(u)}); await updateDoc(doc(db,'users',u),{following:arrayUnion(currentUser.username)}); app.notify(u,'msg','принял заявку'); app.listenNotifs(); },
    openComs: (pid,auth) => { curPost=pid; document.getElementById('comments-modal').style.display='flex'; const l=document.getElementById('comments-list'); onSnapshot(query(collection(db,'posts',pid,'comments'),orderBy('time','asc')),s=>{l.innerHTML=''; s.forEach(d=>{ const c=d.data(); l.innerHTML+=`<div class="comment-card"><b>${c.author}</b><br>${c.text} ${c.author===currentUser.username?`<span class="comment-del" onclick="app.delComment('${d.id}')">×</span>`:''}</div>`;}); iosMoji(); }); },
    sendComment: async () => { const t=document.getElementById('comment-input').value; if(!t)return; await addDoc(collection(db,'posts',curPost,'comments'),{author:currentUser.username,text:t,time:Date.now()}); document.getElementById('comment-input').value=''; },
    delComment: async (id) => { if(confirm('Удалить?')) await deleteDoc(doc(db,'posts',curPost,'comments',id)); },
    delPost: async (id) => { if(confirm('Удалить?')) await deleteDoc(doc(db,'posts',id)); },
    delMsg: async (id,cid) => { if(confirm('Удалить?')) await deleteDoc(doc(db,'chats',cid,'messages',id)); },
    createGroup: async () => { const n=document.getElementById('group-name').value; const id='public_'+Date.now(); await setDoc(doc(db,'groups',id),{id,name:n,desc:document.getElementById('group-desc').value,owner:currentUser.username,members:[currentUser.username],avatar:''}); await updateDoc(doc(db,'users',currentUser.username),{groups:arrayUnion(id)}); ui.closeModals(); ui.nav('groups'); },
    loadGroups: async () => { const c=document.getElementById('groups-list'); const s=await getDocs(query(collection(db,'groups'),limit(20))); c.innerHTML=''; s.forEach(d=>{const g=d.data(); c.innerHTML+=`<div class="card user-row" onclick="ui.nav('profile','${g.id}')"><div class="avatar av-40" style="background:${varColor(g.name)};color:white;display:flex;align-items:center;justify-content:center">${g.avatar?`<img src="${g.avatar}" class="avatar av-40">`:g.name[0]}</div><div><b>${g.name}</b><br><small>${g.members.length} уч.</small></div></div>`;}); },
    searchGroup: async (v) => { if(!v)return app.loadGroups(); const c=document.getElementById('groups-list'); c.innerHTML=''; (await getDocs(query(collection(db,'groups'),orderBy('name'),limit(20)))).forEach(d=>{ const g=d.data(); if(g.name.toLowerCase().includes(v.toLowerCase())) c.innerHTML+=`<div class="card user-row" onclick="ui.nav('profile','${g.id}')"><b>${g.name}</b></div>`; }); },
    joinGroup: async (gid,j) => { const r=doc(db,'groups',gid); if(j) await updateDoc(r,{members:arrayUnion(currentUser.username)}); else await updateDoc(r,{members:arrayRemove(currentUser.username)}); ui.nav('profile',gid); },
    editGroup: async (gid) => { const g=(await getDoc(doc(db,'groups',gid))).data(); document.getElementById('edit-group-name').value=g.name; document.getElementById('edit-group-desc').value=g.desc; document.getElementById('edit-group-id').value=gid; document.getElementById('edit-group-av-prev').src=g.avatar||''; tempAv=null; document.getElementById('edit-group-modal').style.display='flex'; },
    saveGroupChanges: async () => { const gid=document.getElementById('edit-group-id').value; const upd={name:document.getElementById('edit-group-name').value,desc:document.getElementById('edit-group-desc').value}; if(tempAv) upd.avatar=tempAv; await updateDoc(doc(db,'groups',gid),upd); ui.closeModals(); ui.nav('profile',gid); },
    deleteGroup: async (gid) => { if(confirm('Удалить?')) { await deleteDoc(doc(db,'groups',gid)); ui.nav('groups'); }},
    blockUser: async (t,b) => { const me=doc(db,'users',currentUser.username); const him=doc(db,'users',t); if(b) { await updateDoc(me,{blocked:arrayUnion(t)}); await updateDoc(him,{blockedBy:arrayUnion(currentUser.username)}); } else { await updateDoc(me,{blocked:arrayRemove(t)}); await updateDoc(him,{blockedBy:arrayRemove(currentUser.username)}); } ui.nav('profile',t); }
};

// --- MARKET & CASES MODULE ---
window.market = {
    tab: (t) => {
        document.querySelectorAll('.view#view-market .tab').forEach(e=>e.classList.remove('active'));
        // Находим кнопку таба (хак, т.к. нет прямой ссылки)
        const tabs = document.querySelectorAll('.view#view-market .tab');
        if(t==='cases') tabs[0].classList.add('active');
        if(t==='market') tabs[1].classList.add('active');
        if(t==='inventory') tabs[2].classList.add('active');
        
        const c = document.getElementById('market-content');
        c.innerHTML = '';
        
        if(t==='cases') {
            c.innerHTML = `
            <div class="card center-content" style="grid-column: 1 / -1;">
                <h2>Лутбокс "Удача"</h2>
                <div style="font-size:80px">📦</div>
                <p>Цена: <b style="color:var(--gold-color)">${CASE_PRICE} HC</b></p>
                <small>Шанс на 🤡: 0.9%</small><br>
                <button class="action-btn mt-10" onclick="market.buyCase()">Открыть</button>
            </div>`;
        }
        
        if(t==='inventory') {
            const inv = currentUser.inventory || [];
            if(inv.length === 0) c.innerHTML = '<div class="info-box" style="grid-column: 1 / -1;">Пусто. Купите кейс!</div>';
            inv.forEach(item => {
                const rareClass = `item-${item.rarity}`;
                // onclick -> открыть модалку продажи
                c.innerHTML += `<div class="market-item ${rareClass}" onclick="market.openSellModal('${item.id}', '${item.emoji}', '${item.rarity}')">
                    <span class="market-emoji">${item.emoji}</span>
                    <span class="market-count">${item.rarity}</span>
                </div>`;
            });
        }
        
        if(t==='market') {
            market.loadMarketplace();
        }
        iosMoji();
    },

    buyCase: async () => {
        if(currentUser.balance < CASE_PRICE) return alert("Не хватает монет!");
        
        // Списываем деньги
        await updateDoc(doc(db, 'users', currentUser.username), { balance: increment(-CASE_PRICE) });
        currentUser.balance -= CASE_PRICE;
        document.getElementById('settings-bal').innerText = currentUser.balance;

        // Открываем модалку анимации
        document.getElementById('case-modal').style.display = 'flex';
        const resEl = document.getElementById('case-result');
        const spinEl = document.getElementById('case-spinner');
        
        // RNG Logic
        const rand = Math.random() * 100; // 0 - 100
        let type = 'common';
        if (rand < 0.9) type = 'legendary';
        else if (rand < 3) type = 'epic';
        else if (rand < 15) type = 'rare';
        
        const items = ITEMS_DB[type];
        const emoji = items[Math.floor(Math.random() * items.length)];
        const newItem = { id: Date.now() + Math.random().toString(), emoji, rarity: type };

        // Сохраняем в инвентарь
        await updateDoc(doc(db, 'users', currentUser.username), { inventory: arrayUnion(newItem) });
        if(!currentUser.inventory) currentUser.inventory = [];
        currentUser.inventory.push(newItem);

        // Анимация (задержка)
        setTimeout(() => {
            spinEl.classList.add('hidden');
            resEl.innerHTML = `<div class="market-emoji win-anim" style="font-size:100px">${emoji}</div><h3 class="item-${type}">${type.toUpperCase()}!</h3>`;
            resEl.classList.remove('hidden');
            document.getElementById('case-close-btn').classList.remove('hidden');
            
            app.checkStatuses(); // Проверка на "Коллекционера"
            iosMoji();
        }, 1500);
    },

    openSellModal: (id, emoji, rarity) => {
        document.getElementById('sell-item-id').value = id;
        document.getElementById('sell-item-emoji').value = emoji;
        document.getElementById('sell-item-rarity').value = rarity;
        document.getElementById('sell-emoji-preview').innerText = emoji;
        document.getElementById('sell-modal').style.display = 'flex';
        iosMoji();
    },

    confirmSell: async () => {
        const price = parseInt(document.getElementById('sell-price').value);
        if(!price || price < 1) return alert("Цена некорректна");
        
        const id = document.getElementById('sell-item-id').value;
        const emoji = document.getElementById('sell-item-emoji').value;
        const rarity = document.getElementById('sell-item-rarity').value;
        
        const itemObj = currentUser.inventory.find(i => i.id === id);
        if(!itemObj) return alert("Ошибка предмета");

        // Удаляем из инвентаря
        await updateDoc(doc(db, 'users', currentUser.username), { inventory: arrayRemove(itemObj) });
        // Обновляем локально
        currentUser.inventory = currentUser.inventory.filter(i => i.id !== id);

        // Добавляем на рынок
        await addDoc(collection(db, 'market_items'), {
            seller: currentUser.username,
            emoji,
            rarity,
            price,
            itemId: id,
            createdAt: Date.now()
        });

        ui.closeModals();
        market.tab('inventory');
        alert("Выставлено на продажу!");
    },

    loadMarketplace: async () => {
        const c = document.getElementById('market-content');
        c.innerHTML = '<div class="info-box" style="grid-column: 1 / -1;">Загрузка рынка...</div>';
        
        // Получаем все лоты (для прототипа норм, в проде нужна пагинация)
        const q = query(collection(db, 'market_items'), orderBy('price', 'asc'));
        const snaps = await getDocs(q);
        
        if(snaps.empty) {
            c.innerHTML = '<div class="info-box" style="grid-column: 1 / -1;">Рынок пуст</div>';
            return;
        }

        // Агрегация: Группируем по Эмодзи
        const aggregated = {};
        snaps.forEach(d => {
            const item = d.data();
            item.docId = d.id;
            if(!aggregated[item.emoji]) {
                aggregated[item.emoji] = {
                    emoji: item.emoji,
                    minPrice: item.price,
                    count: 0,
                    rarity: item.rarity,
                    items: []
                };
            }
            aggregated[item.emoji].count++;
            aggregated[item.emoji].items.push(item);
            if(item.price < aggregated[item.emoji].minPrice) aggregated[item.emoji].minPrice = item.price;
        });

        c.innerHTML = '';
        Object.values(aggregated).forEach(group => {
            const rareClass = `item-${group.rarity}`;
            // При клике показываем список продавцов (Detailed View)
            const itemHtml = `<div class="market-item ${rareClass}" onclick='market.showDetailed("${group.emoji}")'>
                <span class="market-emoji">${group.emoji}</span>
                <span class="market-price">от ${group.minPrice} HC</span>
                <span class="market-count">${group.count} шт.</span>
            </div>`;
            c.innerHTML += itemHtml;
        });
        
        // Сохраняем данные для детального просмотра
        window.marketState = aggregated;
        iosMoji();
    },

    showDetailed: (emoji) => {
        const group = window.marketState[emoji];
        const c = document.getElementById('market-content');
        
        let html = `<div style="grid-column: 1 / -1;">
            <button class="action-btn btn-sec mb-20" onclick="market.tab('market')">← Назад к списку</button>
            <h2>Купить ${emoji}</h2>
        </div>`;

        group.items.sort((a,b) => a.price - b.price); // Сортировка от дешевых

        group.items.forEach(item => {
            const isMine = item.seller === currentUser.username;
            html += `<div class="card user-row" style="justify-content:space-between">
                <div>
                    <b>Продавец: @${item.seller}</b>
                    <div style="color:var(--gold-color); font-weight:bold;">${item.price} HC</div>
                </div>
                ${isMine 
                    ? `<button class="action-btn btn-danger sm-btn" onclick="market.cancelSell('${item.docId}', '${item.emoji}', '${item.rarity}', '${item.itemId}')">Снять</button>`
                    : `<button class="action-btn sm-btn" onclick="market.buyItem('${item.docId}', ${item.price}, '${item.seller}', '${item.emoji}', '${item.rarity}', '${item.itemId}')">Купить</button>`
                }
            </div>`;
        });
        
        c.innerHTML = html;
        iosMoji();
    },

    buyItem: async (docId, price, seller, emoji, rarity, itemId) => {
        if(currentUser.balance < price) return alert("Не хватает монет!");
        if(!confirm(`Купить за ${price} HC?`)) return;

        try {
            // Транзакция покупки
            await runTransaction(db, async (t) => {
                const itemRef = doc(db, 'market_items', docId);
                const sellerRef = doc(db, 'users', seller);
                const buyerRef = doc(db, 'users', currentUser.username);
                
                const itemDoc = await t.get(itemRef);
                if(!itemDoc.exists()) throw "Предмет уже продан!";
                
                // Перевод денег
                t.update(sellerRef, { balance: increment(price) });
                t.update(buyerRef, { balance: increment(-price) });
                
                // Передача предмета
                const newItem = { id: itemId, emoji, rarity }; // ID сохраняем старый или генерим новый
                t.update(buyerRef, { inventory: arrayUnion(newItem) });
                
                // Удаление с рынка
                t.delete(itemRef);
            });
            
            currentUser.balance -= price;
            alert("Куплено!");
            market.tab('inventory');
        } catch(e) {
            alert("Ошибка: " + e);
        }
    },
    
    cancelSell: async (docId, emoji, rarity, itemId) => {
        // Возврат предмета
        const itemObj = { id: itemId, emoji, rarity };
        await updateDoc(doc(db, 'users', currentUser.username), { inventory: arrayUnion(itemObj) });
        currentUser.inventory.push(itemObj);
        
        await deleteDoc(doc(db, 'market_items', docId));
        alert("Снято с продажи");
        market.tab('market');
    }
};

// --- ADMIN MODULE ---
window.admin = {
    tab: t => {
        const c = document.getElementById('adm-content');
        const b = document.querySelectorAll('.view#view-admin .tab');
        b.forEach(el => el.classList.remove('active'));
        if(t==='users') { b[0].classList.add('active'); c.innerHTML = '<input class="search-bar" oninput="admin.s(this.value)" placeholder="Поиск юзера..."><div id="adm-list"></div>'; }
        if(t==='verify') { b[1].classList.add('active'); admin.loadV(); }
        if(t==='words') { b[2].classList.add('active'); admin.loadW(); }
    },
    stats: async () => {
        const u = await getDocs(collection(db, 'users'));
        document.getElementById('adm-stats').innerHTML = `
            Всего пользователей: <b>${u.size}</b><br>
            <button class="action-btn full-width mt-10" onclick="admin.broadcast()">📢 Рассылка всем</button>
        `;
    },
    broadcast: async () => {
        const txt = prompt("Сообщение для всех:");
        if(!txt) return;
        if(!confirm("Отправить всем?")) return;
        const users = await getDocs(collection(db, 'users'));
        users.forEach(u => {
            addDoc(collection(db, 'users', u.id, 'notifications'), {
                type: 'system', text: txt, time: Date.now(), read: false, from: 'System'
            });
        });
        alert(`Отправлено.`);
    },
    s: async v => {
        const s = await getDocs(query(collection(db,'users'), where('username','>=',v), limit(5)));
        const c = document.getElementById('adm-list'); c.innerHTML='';
        s.forEach(d=> { const u = d.data(); 
            c.innerHTML += `<div class="card">
                <b>${u.username}</b> (${u.status})<br>
                <div style="display:flex; gap:5px; flex-wrap:wrap; margin-top:5px;">
                    <button class="action-btn btn-danger sm-btn" onclick="admin.ban('${u.username}')">${u.isBanned?'Разбан':'Бан'}</button> 
                    <button class="action-btn btn-sec sm-btn" onclick="admin.mute('${u.username}')">${u.isMuted?'Unmute':'Mute'}</button> 
                    <button class="action-btn sm-btn" onclick="admin.warn('${u.username}')">Варн</button>
                    <button class="action-btn btn-danger sm-btn" onclick="admin.delAcc('${u.username}')">DELETE</button>
                    <button class="action-btn btn-gold sm-btn" onclick="admin.toggleAdmin('${u.username}', ${u.isAdmin})">${u.isAdmin?'Снять Адм':'Дать Адм'}</button>
                </div>
            </div>`; 
        });
    },
    loadV: async () => { const s = await getDocs(query(collection(db,'system','verifications','requests'), where('status','==','pending'))); const c = document.getElementById('adm-content'); c.innerHTML = ''; if(s.empty) c.innerHTML='Нет заявок'; s.forEach(d => { const r = d.data(); c.innerHTML += `<div class="card"><b>${r.username}</b>: ${r.realname}<br>${r.reason}<br><div style="margin-top:10px"><button class="action-btn" onclick="admin.okV('${d.id}','${r.username}')">✅</button> <button class="action-btn btn-danger" onclick="admin.noV('${d.id}')">❌</button></div></div>`; }); },
    loadW: () => { document.getElementById('adm-content').innerHTML = `<h3>Фильтр слов</h3><p>Разделяйте запятыми</p><textarea id="adm-words" rows="5">${forbiddenWords.join(', ')}</textarea><button class="action-btn" style="margin-top:10px" onclick="admin.saveW()">Сохранить</button>`; },
    saveW: async () => { const txt = document.getElementById('adm-words').value; const arr = txt.split(',').map(w => w.trim()).filter(w => w); await setDoc(doc(db, 'system', 'config'), { words: arr }, { merge: true }); alert('Сохранено'); forbiddenWords = arr; },
    okV: async (id, u) => { await updateDoc(doc(db,'users',u), {isVerified:true}); await updateDoc(doc(db,'system','verifications','requests',id), {status:'approved'}); alert('OK'); admin.loadV(); },
    noV: async (id) => { if(!confirm('Отклонить?')) return; await updateDoc(doc(db,'system','verifications','requests',id), {status:'rejected'}); alert('Отклонено'); admin.loadV(); },
    ban: async u => { if(confirm('Бан/Разбан?')) { const curr = (await getDoc(doc(db,'users',u))).data().isBanned; await updateDoc(doc(db,'users',u), {isBanned:!curr}); } },
    mute: async u => { const curr = (await getDoc(doc(db,'users',u))).data().isMuted; await updateDoc(doc(db,'users',u), {isMuted:!curr}); alert('Done'); },
    warn: async u => { const r = prompt('Причина варна:'); if(!r) return; const chatId = ['System', u].sort().join('_'); await addDoc(collection(db, 'chats', chatId, 'messages'), { from: 'System', text: "⚠️ ВАРН: "+r, time: Date.now() }); await addDoc(collection(db, 'users', u, 'notifications'), { type: 'msg', text: 'Получил предупреждение!', from: 'System', time: Date.now(), read: false }); alert('Отправлено'); },
    
    // NEW: Delete Account & Toggle Admin
    delAcc: async u => {
        if(prompt(`Введите "${u}" для подтверждения удаления:`) !== u) return;
        await updateDoc(doc(db, 'users', u), { isDeleted: true }); // Soft delete для безопасности
        alert('Пользователь удален (soft delete)');
    },
    toggleAdmin: async (u, current) => {
        if(!confirm(current ? "Снять права админа?" : "Сделать админом?")) return;
        await updateDoc(doc(db, 'users', u), { isAdmin: !current });
        alert('Права изменены');
    }
};

const varColor = (str) => { let hash = 0; for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash); return `hsl(${hash % 360}, 60%, 50%)`; }

app.init();
