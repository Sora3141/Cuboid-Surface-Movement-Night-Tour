import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Global State ---
let N = 4, M = 4, L = 4;
let tiles = {};            
let boxGroup;              
let knightMesh;            
let visitedPath = [];      
let isGameOver = false;
let interactionTargets = []; 

// --- Visual Constants ---
const COLORS = {
    cyan: 0x00f0ff,
    magenta: 0xff00cc,
    white: 0xffffff,
    unvisited: 0x5588aa, 
    bg: 0x1a1a2e 
};

// --- Materials ---
const MATERIALS = {
    glassBase: new THREE.MeshPhysicalMaterial({
        color: COLORS.unvisited,
        metalness: 0.1, roughness: 0.2, transmission: 0.2,
        thickness: 1.0, clearcoat: 1.0, ior: 1.5,
        emissive: 0x112244, emissiveIntensity: 0.4
    }),
    trail: new THREE.MeshPhysicalMaterial({
        color: COLORS.cyan, emissive: COLORS.cyan, emissiveIntensity: 2.0,
        metalness: 0.5, roughness: 0.1, clearcoat: 1.0, transparent: true, opacity: 0.9
    }),
    hint: new THREE.MeshPhysicalMaterial({
        color: COLORS.magenta, emissive: COLORS.magenta, emissiveIntensity: 1.2,
        metalness: 0.5, roughness: 0.1, transparent: true, opacity: 0.85
    }),
    line: new THREE.LineBasicMaterial({ color: 0xaaccff, transparent: true, opacity: 0.6 }),
    collider: new THREE.MeshBasicMaterial({ visible: false })
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.bg);
scene.fog = new THREE.FogExp2(COLORS.bg, 0.02);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

function setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.7); 
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(10, 20, 10);
    sun.castShadow = true;
    scene.add(sun);
    const cyanPoint = new THREE.PointLight(COLORS.cyan, 80);
    cyanPoint.position.set(-10, 10, -10);
    scene.add(cyanPoint);
    const magPoint = new THREE.PointLight(COLORS.magenta, 80);
    magPoint.position.set(10, -10, 10);
    scene.add(magPoint);
}

const faceLayouts = {
    'F': { R: 'R', L: 'L', U: 'U', D: 'D' }, 'B': { R: 'L', L: 'R', U: "U''", D: "D''" },
    'R': { R: 'B', L: 'F', U: "U'", D: "D'''" }, 'L': { R: 'F', L: 'B', U: "U'''", D: "D'" },
    'U': { R: "R'''", L: "L'", U: "B''", D: 'F' }, 'D': { R: "R'", L: "L'''", U: 'F', D: "B''" }
};

function getDim(f) {
    if (f === 'F' || f === 'B') return { w: N, h: M };
    if (f === 'U' || f === 'D') return { w: N, h: L };
    return { w: L, h: M };
}

function rotateVector(dx, dy, rotations) {
    let rx = dx, ry = dy;
    const count = ((rotations % 4) + 4) % 4;
    for (let i = 0; i < count; i++) {
        let tmp = rx; rx = -ry; ry = tmp;
    }
    return { x: rx, y: ry };
}

function walk(f, x, y, dx, dy, accRot) {
    if (dx === 0 && dy === 0) return { f, x, y, rot: accRot };
    let sx = Math.sign(dx), sy = Math.sign(dy);
    let nx = x + sx, ny = y + sy;
    let dim = getDim(f);

    if (nx >= 0 && nx < dim.w && ny >= 0 && ny < dim.h) {
        return walk(f, nx, ny, dx - sx, dy - sy, accRot);
    } else {
        const layout = faceLayouts[f];
        let exitEdge = (nx < 0) ? 'L' : (nx >= dim.w) ? 'R' : (ny < 0) ? 'D' : 'U';
        const conn = layout[exitEdge];
        const nextF = conn.replace(/'/g, "");
        const rotCount = (conn.match(/'/g) || []).length;
        const nDim = getDim(nextF);
        let entryW = nDim.w, entryH = nDim.h;
        if (rotCount % 2 !== 0) { entryW = nDim.h; entryH = nDim.w; }
        let scalar = (exitEdge === 'U' || exitEdge === 'D') ? x : y;
        let localX, localY;
        if (exitEdge === 'R') { localX = 0; localY = scalar; }
        else if (exitEdge === 'L') { localX = entryW - 1; localY = scalar; }
        else if (exitEdge === 'U') { localX = scalar; localY = 0; }
        else if (exitEdge === 'D') { localX = scalar; localY = entryH - 1; }
        let curW = entryW, curH = entryH;
        for (let i = 0; i < rotCount; i++) {
            let tmpX = localX; localX = (curH - 1) - localY; localY = tmpX;
            let tmpDim = curW; curW = curH; curH = tmpDim;
        }
        let remX = dx - sx, remY = dy - sy;
        for (let i = 0; i < rotCount; i++) {
            let tmpD = remX; remX = -remY; remY = tmpD;
        }
        return walk(nextF, Math.max(0, Math.min(nDim.w - 1, localX)), Math.max(0, Math.min(nDim.h - 1, localY)), remX, remY, accRot + rotCount);
    }
}

function createKnight() {
    if (knightMesh) scene.remove(knightMesh);
    const group = new THREE.Group();
    const coreMat = new THREE.MeshBasicMaterial({ color: COLORS.cyan });
    const shellMat = new THREE.MeshPhysicalMaterial({
        color: COLORS.cyan, metalness: 0.1, roughness: 0.1, transmission: 0.9, thickness: 1.0, emissive: COLORS.cyan, emissiveIntensity: 0.5
    });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), coreMat);
    const shell = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), shellMat);
    const innerGroup = new THREE.Group();
    innerGroup.add(core, shell);
    innerGroup.rotation.set(0, Math.PI / 4, 0); 
    const animHolder = new THREE.Group();
    animHolder.add(innerGroup);
    innerGroup.position.set(0, 0, 0); 
    group.add(animHolder);
    knightMesh = group;
    scene.add(knightMesh);
    knightMesh.visible = false;
}

function updateKnightPositionToTile(tileMesh) {
    if (!knightMesh || !tileMesh) return;
    knightMesh.visible = true;
    const targetPos = new THREE.Vector3();
    tileMesh.getWorldPosition(targetPos);
    const targetQuat = new THREE.Quaternion();
    tileMesh.getWorldQuaternion(targetQuat);
    const offset = new THREE.Vector3(0, 0, 0.36); 
    offset.applyQuaternion(targetQuat);
    targetPos.add(offset);
    knightMesh.position.copy(targetPos);
    knightMesh.quaternion.copy(targetQuat);
}

function createLevel() {
    if (boxGroup) scene.remove(boxGroup);
    boxGroup = new THREE.Group(); 
    scene.add(boxGroup);
    
    tiles = { 'F': [], 'B': [], 'U': [], 'D': [], 'R': [], 'L': [] };
    interactionTargets = []; 
    visitedPath = []; 
    isGameOver = false;

    const tileGeom = new THREE.BoxGeometry(0.92, 0.92, 0.05);
    const edgeGeom = new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.92, 0.92));
    const colliderGeom = new THREE.PlaneGeometry(0.95, 0.95);

    const faceData = [
        { id: 'F', w: N, h: M, p: [0, 0, L / 2], r: [0, 0, 0] },
        { id: 'B', w: N, h: M, p: [0, 0, -L / 2], r: [0, Math.PI, 0] },
        { id: 'U', w: N, h: L, p: [0, M / 2, 0], r: [-Math.PI / 2, 0, 0] },
        { id: 'D', w: N, h: L, p: [0, -M / 2, 0], r: [Math.PI / 2, 0, 0] },
        { id: 'R', w: L, h: M, p: [N / 2, 0, 0], r: [0, Math.PI / 2, 0] },
        { id: 'L', w: L, h: M, p: [-N / 2, 0, 0], r: [0, -Math.PI / 2, 0] }
    ];

    faceData.forEach(f => {
        const g = new THREE.Group(); 
        g.position.set(...f.p); 
        g.rotation.set(...f.r);
        g.updateMatrixWorld(true);

        for (let x = 0; x < f.w; x++) {
            tiles[f.id][x] = [];
            for (let y = 0; y < f.h; y++) {
                const mesh = new THREE.Mesh(tileGeom, MATERIALS.glassBase.clone());
                mesh.position.set(x - f.w / 2 + 0.5, y - f.h / 2 + 0.5, 0);
                mesh.castShadow = true;
                mesh.receiveShadow = true;

                const frame = new THREE.LineSegments(edgeGeom, MATERIALS.line.clone());
                frame.position.z = 0.03;
                mesh.add(frame);

                tiles[f.id][x][y] = { mesh, frame };
                g.add(mesh);

                const collider = new THREE.Mesh(colliderGeom, MATERIALS.collider);
                collider.position.copy(mesh.position);
                collider.position.z = 0.05; 
                collider.userData = { f: f.id, x, y };
                g.add(collider);
                interactionTargets.push(collider);
            }
        }
        boxGroup.add(g);
    });

    createKnight();
    
    const maxDim = Math.max(N, M, L);
    const camDist = maxDim * 2.0;
    camera.position.set(camDist, camDist, camDist);
    controls.minDistance = maxDim;
    controls.maxDistance = maxDim * 4;
    controls.update();

    updateVisuals(); 
}

function updateVisuals() {
    const infoEl = document.getElementById('pos-info');
    const total = N*M*2 + N*L*2 + M*L*2;
    
    Object.keys(tiles).forEach(f => tiles[f].forEach(c => c.forEach(t => {
        t.mesh.material = MATERIALS.glassBase;
        t.mesh.scale.set(1, 1, 1);
        t.frame.material.emissiveIntensity = 0.4;
        t.frame.material.color.set(0xaaccff);
    })));

    visitedPath.forEach((p, i) => {
        const isLast = i === visitedPath.length - 1;
        const t = tiles[p.f][p.x][p.y];
        t.mesh.material = MATERIALS.trail;
        t.frame.material.opacity = 1.0;
        if (isLast) t.mesh.scale.set(1.1, 1.1, 1.1);
    });

    if (visitedPath.length > 0) {
        const last = visitedPath[visitedPath.length - 1];
        const targetTile = tiles[last.f][last.x][last.y].mesh;
        updateKnightPositionToTile(targetTile);
        const nextMoves = getPossibleMoves(last).filter(m => !visitedPath.some(v => v.id === `${m.f}_${m.x}_${m.y}`));
        nextMoves.forEach(m => { 
            if (tiles[m.f]?.[m.x]?.[m.y]) {
                const tileObj = tiles[m.f][m.x][m.y];
                tileObj.mesh.material = MATERIALS.hint;
                tileObj.frame.material.emissive = new THREE.Color(COLORS.magenta);
                tileObj.frame.material.emissiveIntensity = 0.6;
            }
        });

        if (visitedPath.length === total) {
            infoEl.innerHTML = "<span style='color:#fff'>MISSION COMPLETE</span>";
            isGameOver = true;
        } else if (nextMoves.length === 0) {
            infoEl.innerHTML = "<span style='color:#ff0000'>SYSTEM HALT / NO MOVES</span>";
            isGameOver = true;
        } else {
            const progress = Math.round((visitedPath.length / total) * 100);
            infoEl.innerText = `PROGRESS: ${progress}% [${visitedPath.length}/${total}]`;
        }
    } else {
        if (knightMesh) knightMesh.visible = false;
        infoEl.innerText = "WAITING FOR INPUT...";
    }
}

function getPossibleMoves(current) {
    const { f, x, y } = current;
    const patterns = [[1, 2], [1, -2], [-1, 2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1]];
    let possible = [];
    patterns.forEach(([mx, my]) => {
        let pA1 = walk(f, x, y, mx, 0, 0);
        possible.push(walk(pA1.f, pA1.x, pA1.y, rotateVector(0, my, pA1.rot).x, rotateVector(0, my, pA1.rot).y, pA1.rot));
        let pB1 = walk(f, x, y, 0, my, 0);
        possible.push(walk(pB1.f, pB1.x, pB1.y, rotateVector(mx, 0, pB1.rot).x, rotateVector(mx, 0, pB1.rot).y, pB1.rot));
    });
    return possible;
}

function moveTo(targetData) {
    if (isGameOver) return;
    const id = `${targetData.f}_${targetData.x}_${targetData.y}`;
    if (visitedPath.some(p => p.id === id)) return; 
    visitedPath.push({ ...targetData, id });
    updateVisuals();
}

function undoMove() {
    if (visitedPath.length === 0) return;
    visitedPath.pop();
    isGameOver = false;
    updateVisuals();
}

function init() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    document.getElementById('canvas-container').appendChild(renderer.domElement);
    
    setupLighting();
    createLevel();

    window.addEventListener('resize', () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    });

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    renderer.domElement.addEventListener('mousedown', (e) => {
        // [スマホ対応] クリック判定時のサイズ強制同期
        if (renderer.domElement.width !== window.innerWidth * Math.min(window.devicePixelRatio, 2)) {
             renderer.setSize(window.innerWidth, window.innerHeight);
             camera.aspect = window.innerWidth / window.innerHeight;
             camera.updateProjectionMatrix();
        }

        e.preventDefault();
        const rect = renderer.domElement.getBoundingClientRect();
        
        mouse.x = ( ( e.clientX - rect.left ) / rect.width ) * 2 - 1;
        mouse.y = - ( ( e.clientY - rect.top ) / rect.height ) * 2 + 1;
        
        raycaster.setFromCamera(mouse, camera);

        const intersects = raycaster.intersectObjects(interactionTargets, false);
        if (intersects.length > 0) {
            const target = intersects[0].object;
            const data = target.userData;

            if (data && !isGameOver) {
                const last = visitedPath.length > 0 ? visitedPath[visitedPath.length - 1] : null;
                if (visitedPath.length === 0 || getPossibleMoves(last).some(m => m.f === data.f && m.x === data.x && m.y === data.y)) {
                    const id = `${data.f}_${data.x}_${data.y}`;
                    if (!visitedPath.some(v => v.id === id)) {
                        moveTo(data);
                    }
                }
            }
        }
    });

    // --- Mobile Menu Interaction ---
    const menuBtn = document.getElementById('mobile-menu-btn');
    const closeBtn = document.getElementById('close-menu-btn');
    const panel = document.getElementById('main-panel');
    const mobileUndo = document.getElementById('mobile-undo-btn');

    if(menuBtn && panel) {
        menuBtn.addEventListener('click', () => {
            panel.classList.add('active');
        });
    }
    if(closeBtn && panel) {
        closeBtn.addEventListener('click', () => {
            panel.classList.remove('active');
        });
    }
    if(mobileUndo) {
        mobileUndo.addEventListener('click', undoMove);
    }

    const updateSize = () => {
        N = parseInt(document.getElementById('inN').value);
        M = parseInt(document.getElementById('inM').value);
        L = parseInt(document.getElementById('inL').value);
        ['N','M','L'].forEach(id => document.getElementById(`val${id}`).innerText = eval(id));
        createLevel();
        // パネルを閉じる（UX向上）
        if(panel) panel.classList.remove('active');
    };
    ['N','M','L'].forEach(id => document.getElementById(`in${id}`).addEventListener('input', updateSize));
    
    document.getElementById('btnUndo').addEventListener('click', () => { 
        visitedPath.pop(); 
        isGameOver=false; 
        updateVisuals(); 
    });
    
    document.getElementById('btnApply').addEventListener('click', () => { 
        if(confirm("REBOOT CORE?")) updateSize(); 
    });

    const clock = new THREE.Clock();
    function animate() {
        requestAnimationFrame(animate);
        const delta = clock.getElapsedTime();
        controls.update();

        if (knightMesh && knightMesh.visible) {
             const floatZ = Math.sin(delta * 2) * 0.03;
             knightMesh.children[0].position.z = 0.36 + floatZ; 
             knightMesh.children[0].children[0].rotation.y += 0.02; 
        }
        
        if (boxGroup) {
            boxGroup.rotation.y = Math.sin(delta * 0.1) * 0.05;
        }

        renderer.render(scene, camera);
    }
    animate();
}

init();