document.addEventListener('DOMContentLoaded', () => {
    // --- 定数 ---
    const R = 6371; // 地球の半径 (km)
    // スコア計算の重み (デフォルト値、合計が1になるように)
    let weights = {
        priority: 0.5,
        waitTime: 0.3,
        distance: 0.2
    };

    // --- DOM要素 ---
    const listContainer = document.getElementById('attractions-list');
    const sortSelect = document.getElementById('sort-select');
    const areaFilter = document.getElementById('filter-area');
    const hideDoneCheckbox = document.getElementById('hide-done');
    const refreshButton = document.getElementById('refresh-button');
    const recommendationList = document.getElementById('recommendation-list');
    const currentLocationNameSpan = document.getElementById('current-location-name');
    const weightPrioritySlider = document.getElementById('weight-priority');
    const weightWaitSlider = document.getElementById('weight-wait');
    const weightDistanceSlider = document.getElementById('weight-distance');
    const weightSumWarning = document.getElementById('weight-sum-warning');


    // --- 状態変数 ---
    let attractions = []; // 全アトラクションデータ (状態含む)
    let uniqueAreas = new Set();
    let currentLocation = null; // { id, name, lat, lon }
    let maxWaitTime = 180; // 想定される最大待ち時間（スコア正規化用）
    let maxDistance = 2.0; // 想定される最大移動距離(km)（スコア正規化用）パークの広さで調整

    // --- 初期化処理 ---
    function initialize() {
        loadWeights(); // 重みを読み込み
        updateWeightSliders(); // スライダーに反映
        setupWeightListeners(); // スライダーのリスナー設定

        fetch('attractions_data_with_coords.json') // JSONファイル名変更
            .then(response => response.json())
            .then(data => {
                attractions = data.map(item => ({
                    ...item,
                    waitTime: null,
                    status: '未体験',
                    score: 0, // スコア初期値
                    distance: null // 現在地からの距離初期値
                }));
                loadState(); // ローカルストレージから状態復元
                populateAreaFilter();
                calculateMaxValues(); // 最大待ち時間・距離をデータから推測(任意)
                renderAttractionList(); // アトラクション一覧描画
                updateRecommendations(); // おすすめ計算・表示
            })
            .catch(error => {
                console.error('アトラクションデータの読み込みに失敗しました:', error);
                listContainer.innerHTML = '<p>データの読み込みに失敗しました。</p>';
            });
    }

    // --- データ読み込み・状態管理 (ローカルストレージ) ---
    function saveState() {
        const stateToSave = attractions.map(att => ({
            id: att.id, waitTime: att.waitTime, status: att.status
        }));
        localStorage.setItem('attractionStates_v2', JSON.stringify(stateToSave)); // version up
        localStorage.setItem('currentLocation_v2', JSON.stringify(currentLocation));
        // フィルタとソートの状態も保存
        localStorage.setItem('selectedSort_v2', sortSelect.value);
        localStorage.setItem('selectedAreaFilter_v2', areaFilter.value);
        localStorage.setItem('hideDoneChecked_v2', hideDoneCheckbox.checked);
    }

    function loadState() {
        const savedStates = localStorage.getItem('attractionStates_v2');
        if (savedStates) {
            const parsedStates = JSON.parse(savedStates);
            parsedStates.forEach(saved => {
                const index = attractions.findIndex(att => att.id === saved.id);
                if (index !== -1) {
                    attractions[index].waitTime = saved.waitTime;
                    attractions[index].status = saved.status;
                }
            });
        }
        const savedLocation = localStorage.getItem('currentLocation_v2');
        if (savedLocation) {
            currentLocation = JSON.parse(savedLocation);
            currentLocationNameSpan.textContent = currentLocation ? currentLocation.name : '未設定';
        }
        // フィルタとソートの状態を復元
        sortSelect.value = localStorage.getItem('selectedSort_v2') || 'priority';
        areaFilter.value = localStorage.getItem('selectedAreaFilter_v2') || '';
        hideDoneCheckbox.checked = localStorage.getItem('hideDoneChecked_v2') === 'true';
    }

    function saveWeights() {
        localStorage.setItem('scoreWeights_v2', JSON.stringify(weights));
    }
    function loadWeights() {
         const savedWeights = localStorage.getItem('scoreWeights_v2');
         if (savedWeights) {
            weights = JSON.parse(savedWeights);
         }
    }
     function updateWeightSliders() {
        weightPrioritySlider.value = weights.priority;
        weightWaitSlider.value = weights.waitTime;
        weightDistanceSlider.value = weights.distance;
        checkWeightSum();
    }
     function setupWeightListeners() {
        [weightPrioritySlider, weightWaitSlider, weightDistanceSlider].forEach(slider => {
            slider.addEventListener('input', () => {
                weights.priority = parseFloat(weightPrioritySlider.value);
                weights.waitTime = parseFloat(weightWaitSlider.value);
                weights.distance = parseFloat(weightDistanceSlider.value);
                checkWeightSum();
                saveWeights(); // 重みを保存
                updateRecommendations(); // おすすめを再計算
            });
        });
     }

    function checkWeightSum() {
        const sum = weights.priority + weights.waitTime + weights.distance;
        // 浮動小数点誤差を考慮
        if (Math.abs(sum - 1.0) > 0.01) {
             weightSumWarning.style.display = 'inline';
        } else {
             weightSumWarning.style.display = 'none';
        }
    }


    // --- ユーティリティ関数 ---
    // 緯度経度から距離を計算 (Haversine formula)
    function getDistance(lat1, lon1, lat2, lon2) {
        if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
        const dLat = deg2rad(lat2 - lat1);
        const dLon = deg2rad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c; // 距離 (km)
    }
    function deg2rad(deg) {
        return deg * (Math.PI / 180);
    }

     // 最大待ち時間と最大距離をデータから推測（オプション）
    function calculateMaxValues() {
         let maxLat = -Infinity, minLat = Infinity, maxLon = -Infinity, minLon = Infinity;
         let maxW = 0;
         attractions.forEach(att => {
             if(att.lat) {
                 maxLat = Math.max(maxLat, att.lat);
                 minLat = Math.min(minLat, att.lat);
             }
             if(att.lon) {
                 maxLon = Math.max(maxLon, att.lon);
                 minLon = Math.min(minLon, att.lon);
             }
             // 待ち時間は手動入力に依存するので、固定値か、保存データから最大値を取る
             if (att.waitTime !== null && att.waitTime > maxW) {
                 maxW = att.waitTime;
             }
         });
         // パーク内の最大距離をざっくり計算
         if (minLat !== Infinity) {
             const dist1 = getDistance(minLat, minLon, maxLat, maxLon);
             const dist2 = getDistance(minLat, maxLon, maxLat, minLon); // 対角線
             maxDistance = Math.max(dist1 || 0 , dist2 || 0) * 1.1; // 少し余裕を持たせる
         }
         maxWaitTime = Math.max(maxWaitTime, maxW); // 記録された最大待ち時間も考慮

         // console.log(`Max Wait Time set to: ${maxWaitTime}, Max Distance set to: ${maxDistance.toFixed(2)} km`);
    }

    // --- コアロジック ---
    // スコア計算
    function calculateScore(attraction) {
        if (!attraction || attraction.status !== '未体験') {
            return 0; // 体験済みや休止中はスコア0
        }

        // 1. 優先度スコア (priorityが小さいほど高スコア -> 逆数的にするか、最大値から引く)
        // 例: priority 1=1.0, 2=0.8, 3=0.6, 4=0.4, 5=0.2 (最大優先度を5と仮定)
        const maxPriority = 5; // パークに合わせて調整
        const priorityScore = Math.max(0, (maxPriority - attraction.priority + 1) / maxPriority);

        // 2. 待ち時間スコア (短いほど高スコア: 0分=1.0, maxWaitTime分=0)
        const waitTime = attraction.waitTime === null || attraction.waitTime === '' ? maxWaitTime : parseInt(attraction.waitTime, 10);
        // maxWaitTimeを超える場合も考慮
        const clampedWaitTime = Math.min(waitTime, maxWaitTime);
        const waitTimeScore = Math.max(0, 1.0 - (clampedWaitTime / maxWaitTime));

        // 3. 距離スコア (近いほど高スコア: 0km=1.0, maxDistance km=0)
        let distanceScore = 0.5; // 現在地不明の場合は中間値
        if (currentLocation && attraction.lat !== undefined && attraction.lon !== undefined) {
            const distance = getDistance(currentLocation.lat, currentLocation.lon, attraction.lat, attraction.lon);
            attraction.distance = distance; // 距離を記録
            if (distance !== null) {
                // maxDistanceを超える場合も考慮
                 const clampedDistance = Math.min(distance, maxDistance);
                 distanceScore = Math.max(0, 1.0 - (clampedDistance / maxDistance));
            }
        } else {
             attraction.distance = null; // 距離不明
        }

        // 重み付けして合計スコアを計算
        const totalScore = (weights.priority * priorityScore) +
                           (weights.waitTime * waitTimeScore) +
                           (weights.distance * distanceScore);

        // console.log(`${attraction.name}: P=${priorityScore.toFixed(2)}, W=${waitTimeScore.toFixed(2)}, D=${distanceScore.toFixed(2)} -> Score=${totalScore.toFixed(3)}`);
        return totalScore;
    }

    // おすすめリスト更新
    function updateRecommendations() {
        // 全アトラクションのスコアを再計算
        attractions.forEach(att => {
            att.score = calculateScore(att);
        });

        // スコア上位の未体験アトラクションを取得
        const recommended = attractions
            .filter(att => att.status === '未体験')
            .sort((a, b) => b.score - a.score) // スコア降順
            .slice(0, 3); // 上位3件

        // リスト表示を更新
        recommendationList.innerHTML = ''; // クリア
        if (recommended.length === 0) {
            recommendationList.innerHTML = '<li>おすすめはありません (すべて体験済みか、情報不足)</li>';
        } else {
            recommended.forEach(att => {
                const li = document.createElement('li');
                const distanceText = att.distance !== null ? `${(att.distance * 1000).toFixed(0)}m` : '距離不明';
                const waitText = att.waitTime !== null ? `${att.waitTime}分` : '待ち時間不明';
                 li.innerHTML = `
                    <strong>${att.name}</strong> (優先度: ${att.priority})<br>
                    予測スコア: ${att.score.toFixed(3)} <small>[${waitText} / ${distanceText}]</small>
                `;
                recommendationList.appendChild(li);
            });
        }
    }

    // アトラクション一覧描画 (変更点: スコア表示、ここに行ったボタン追加)
    function renderAttractionList() {
        listContainer.innerHTML = ''; // リストをクリア

        // フィルタリング (前回同様)
        let filteredAttractions = attractions.filter(att => {
            const areaMatch = !areaFilter.value || att.area === areaFilter.value;
            const statusMatch = !hideDoneCheckbox.checked || att.status !== '体験済';
            return areaMatch && statusMatch;
        });

        // ソート (スコア順を追加)
        const sortValue = sortSelect.value;
        filteredAttractions.sort((a, b) => {
            if (sortValue === 'priority') return a.priority - b.priority || (a.waitTime ?? Infinity) - (b.waitTime ?? Infinity);
            if (sortValue === 'wait-time') {
                 const waitA = a.waitTime === null || a.waitTime === '' ? Infinity : parseInt(a.waitTime, 10);
                 const waitB = b.waitTime === null || b.waitTime === '' ? Infinity : parseInt(b.waitTime, 10);
                 return waitA - waitB || a.priority - b.priority;
            }
            if (sortValue === 'name') return a.name.localeCompare(b.name, 'ja');
            if (sortValue === 'score') return b.score - a.score; // スコア降順
            return 0;
        });

        // HTML要素生成
        filteredAttractions.forEach(att => {
            const div = document.createElement('div');
            div.classList.add('attraction');
            if (att.status === '体験済') div.classList.add('done');
            if (currentLocation && att.id === currentLocation.id) div.style.borderColor = 'blue'; // 現在地を強調
            div.dataset.id = att.id;

            const distanceText = att.distance !== null ? ` / 距離: ${(att.distance * 1000).toFixed(0)}m` : '';
            const scoreText = att.score > 0 ? ` / スコア: ${att.score.toFixed(3)}` : ''; // スコア表示

            div.innerHTML = `
                <h2>${att.name}</h2>
                <p>エリア: ${att.area} / 優先度: ${att.priority}${scoreText}${distanceText}</p> <p>${att.notes || ''}</p>
                <div>
                    <label for="wait-${att.id}">待ち時間(分):</label>
                    <input type="number" id="wait-${att.id}" min="0" step="5" value="${att.waitTime !== null ? att.waitTime : ''}" placeholder="---">
                </div>
                <div class="status-controls">
                    ステータス:
                    <select id="status-${att.id}">
                        <option value="未体験" ${att.status === '未体験' ? 'selected' : ''}>未体験</option>
                        <option value="体験済" ${att.status === '体験済' ? 'selected' : ''}>体験済</option>
                        <option value="休止中" ${att.status === '休止中' ? 'selected' : ''}>休止中</option>
                    </select>
                </div>
                <div class="actions">
                    <button class="set-location-btn">ここに行った (現在地に設定)</button>
                </div>
            `;
            listContainer.appendChild(div);

            // --- イベントリスナー ---
            // 待ち時間入力
            const waitInput = div.querySelector(`#wait-${att.id}`);
            waitInput.addEventListener('change', (e) => {
                const value = e.target.value === '' ? null : parseInt(e.target.value, 10);
                updateAttractionState(att.id, 'waitTime', isNaN(value) ? null : value);
                // スコア再計算のため全体更新をトリガー
                updateRecommendations();
                 renderAttractionList(); // スコア表示等を更新するため再描画
                 saveState();
            });
            // ステータス変更
            const statusSelect = div.querySelector(`#status-${att.id}`);
             statusSelect.addEventListener('change', (e) => {
                updateAttractionState(att.id, 'status', e.target.value);
                 // スコア再計算・表示更新
                updateRecommendations();
                 renderAttractionList(); // クラス等反映のため再描画
                saveState();
             });
            // 「ここに行った」ボタン
            const setLocationBtn = div.querySelector('.set-location-btn');
             setLocationBtn.addEventListener('click', () => {
                // 現在地を設定
                 currentLocation = { id: att.id, name: att.name, lat: att.lat, lon: att.lon };
                 currentLocationNameSpan.textContent = currentLocation.name;
                 // ステータスも「体験済」にする
                 updateAttractionState(att.id, 'status', '体験済');
                 // 全体のスコア・おすすめを更新して再描画
                 updateRecommendations();
                 renderAttractionList();
                 saveState(); // 現在地と状態を保存
             });
        });
    }

     // アトラクションの状態を更新 (汎用)
     function updateAttractionState(id, key, value) {
        const index = attractions.findIndex(att => att.id === id);
        if (index !== -1) {
            attractions[index][key] = value;
            // 必要ならここでスコアを直接更新しても良いが、全体更新の方が確実
            // attractions[index].score = calculateScore(attractions[index]);
        }
    }

    // エリアフィルター生成 (変更なし)
    function populateAreaFilter() {
        uniqueAreas.clear();
        attractions.forEach(att => uniqueAreas.add(att.area));
        const sortedAreas = Array.from(uniqueAreas).sort();
        areaFilter.innerHTML = '<option value="">全エリア</option>';
        sortedAreas.forEach(area => {
            const option = document.createElement('option');
            option.value = area; option.textContent = area; areaFilter.appendChild(option);
        });
        areaFilter.value = localStorage.getItem('selectedAreaFilter_v2') || ''; // 状態復元
    }


    // --- 初期化呼び出し & コントロールイベントリスナー ---
    initialize(); // 初期化処理を開始

    sortSelect.addEventListener('change', () => {
        localStorage.setItem('selectedSort_v2', sortSelect.value); renderAttractionList();
    });
    areaFilter.addEventListener('change', () => {
        localStorage.setItem('selectedAreaFilter_v2', areaFilter.value); renderAttractionList();
    });
    hideDoneCheckbox.addEventListener('change', () => {
        localStorage.setItem('hideDoneChecked_v2', hideDoneCheckbox.checked); renderAttractionList();
    });
    // 更新ボタンは全体再計算・再描画
    refreshButton.addEventListener('click', () => {
         updateRecommendations();
         renderAttractionList();
    });

});
