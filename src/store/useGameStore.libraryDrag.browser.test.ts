import { test, expect } from '@playwright/test';

// Este teste usa Playwright Test Runner para E2E
// Para executar: pnpm test:playwright useGameStore.libraryDrag.browser.test.ts
// O servidor de dev será iniciado automaticamente pelo Playwright

test.describe('Library drag performance - E2E (Host and Peer)', () => {
  test.beforeEach(async ({ page }) => {
    // Navegar para a aplicação usando page.goto()
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

test('should handle rapid library movements without lag when dragging deck', async ({ page }, testInfo) => {
    const roomId = `test-room-${testInfo.workerIndex}-${Date.now()}`;
    // 1. Criar uma sala como host
    const menuRoomButton = page.getByTestId('menu-room-button');
    await menuRoomButton.waitFor({ state: 'visible', timeout: 10000 });
    await menuRoomButton.click();
    console.log('Menu room button clicked');
    
    await page.waitForTimeout(500);
    
    // Preencher nome
    const nameInput = page.getByTestId('room-player-name-input');
    await nameInput.waitFor({ state: 'visible', timeout: 5000 });
    await nameInput.fill('test-user-browser');
    console.log('Name filled');
    
    // Preencher room id
    const roomIdInput = page.getByTestId('room-id-input');
    await roomIdInput.waitFor({ state: 'visible', timeout: 5000 });
    await roomIdInput.fill(roomId);
    console.log('Room ID filled');
    
    // Clicar no botão "Create"
    const createButton = page.getByTestId('room-create-button');
    await createButton.waitFor({ state: 'visible', timeout: 5000 });
    await createButton.click();
    console.log('Create button clicked');
    
    // Aguardar sala ser criada
    await page.waitForTimeout(2000);
    
    // Fechar o modal do room pressionando Escape ou clicando no botão de fechar
    try {
      const closeButton = page.locator('.modal-close');
      await closeButton.click({ timeout: 2000 });
    } catch (e) {
      // Se não encontrar botão, pressionar Escape
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(500);
    
    // 2. Resetar o board antes de carregar o deck
    page.once('dialog', (dialog) => dialog.accept());
    const resetBoardButton = page.getByTitle('Reset Board');
    await resetBoardButton.waitFor({ state: 'visible', timeout: 10000 });
    await resetBoardButton.click();
    await page.waitForTimeout(1000);
    
    // 3. Carregar deck com 50 Birds of Paradise
    // Clicar no botão do deck menu (usando title)
    const deckMenuButton = page.getByTitle('Deck Manager');
    await deckMenuButton.waitFor({ state: 'visible', timeout: 10000 });
    await deckMenuButton.click();
    console.log('Deck menu button clicked');
    await page.waitForTimeout(1000);
    
    // Preencher textarea com deck (o DeckManager tem um textarea para o deck list)
    const deckTextarea = page.locator('textarea').first();
    await deckTextarea.waitFor({ state: 'visible', timeout: 5000 });
    await deckTextarea.fill('50 Birds of Paradise');
    console.log('Deck filled');
    
    // Clicar no botão "Load to Library" que faz parse + add + fecha o modal
    const loadToLibraryButton = page.getByTestId('load-to-library-button');
    await loadToLibraryButton.waitFor({ state: 'visible', timeout: 5000 });
    await loadToLibraryButton.click();
    console.log('Deck loaded to library');
    
    // Aguardar deck ser carregado e processado (o modal fecha automaticamente)
    await page.waitForTimeout(5000);
    
    // 3. Encontrar o elemento da library
    const libraryElement = page.getByTestId('library-test-user-browser');
    await libraryElement.waitFor({ state: 'visible', timeout: 15000 });
    console.log('Library element found');
    
    // 4. Simular drag extensivo usando page.mouse do Playwright
    // Monitorar tanto o movimento do mouse quanto a posição real do elemento
    const movements: Array<{ 
      mouseX: number; 
      mouseY: number; 
      elementX: number; 
      elementY: number; 
      time: number;
      elementMoved: boolean;
    }> = [];
    const startTime = Date.now();
    
    const initialBoundingBox = await libraryElement.boundingBox();
    if (!initialBoundingBox) {
      throw new Error('Could not get library bounding box');
    }

    const halfWidth = initialBoundingBox.width / 2;
    const halfHeight = initialBoundingBox.height / 2;

    const boardBox = await page.locator('main.board-fullscreen').boundingBox();
    if (!boardBox) {
      throw new Error('Could not get board bounding box');
    }
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

    // Centralizar o library antes do teste para garantir ponto inicial no meio
    const centerX = clamp(
      boardBox.x + boardBox.width / 2,
      boardBox.x + halfWidth,
      boardBox.x + boardBox.width - halfWidth
    );
    const centerY = clamp(
      boardBox.y + boardBox.height / 2,
      boardBox.y + halfHeight,
      boardBox.y + boardBox.height - halfHeight
    );
    const initialX = initialBoundingBox.x + halfWidth;
    const initialY = initialBoundingBox.y + halfHeight;
    await page.mouse.move(initialX, initialY);
    await page.mouse.down();
    await page.mouse.move(centerX, centerY, { steps: 8 });
    await page.mouse.up();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.evaluate(() => new Promise(requestAnimationFrame));
    
    const startX = centerX;
    const startY = centerY;
    
    // Função para obter a posição atual do elemento
    const getElementPosition = async () => {
      const box = await libraryElement.boundingBox();
      if (!box) return null;
      return {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2
      };
    };
    
    // Usar page.mouse diretamente do Playwright
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    
    let previousElementPos = await getElementPosition();
    const movementSteps = 60;
    
    for (let i = 0; i < movementSteps; i++) {
      const angle = (i / movementSteps) * Math.PI * 2;
      const radius = 50 + (i % 20) * 10;
      const targetX = clamp(
        startX + Math.cos(angle) * radius,
        boardBox.x + halfWidth,
        boardBox.x + boardBox.width - halfWidth
      );
      const targetY = clamp(
        startY + Math.sin(angle) * radius,
        boardBox.y + halfHeight,
        boardBox.y + boardBox.height - halfHeight
      );
      
      await page.mouse.move(targetX, targetY, { steps: 6 });
      
      // Esperar um frame para o DOM refletir o movimento
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await page.evaluate(() => new Promise(requestAnimationFrame));
      
      // Verificar a posição atual do elemento
      const currentElementPos = await getElementPosition();
      const elementMoved = previousElementPos && currentElementPos ? 
        Math.sqrt(
          Math.pow(currentElementPos.x - previousElementPos.x, 2) + 
          Math.pow(currentElementPos.y - previousElementPos.y, 2)
        ) > 1 : false; // Considera movimento se moveu mais de 1px
      
      movements.push({
        mouseX: targetX,
        mouseY: targetY,
        elementX: currentElementPos?.x ?? 0,
        elementY: currentElementPos?.y ?? 0,
        time: Date.now() - startTime,
        elementMoved
      });
      
      previousElementPos = currentElementPos;
    }
    
    await page.mouse.up();
    
    const totalTime = Date.now() - startTime;
    console.log(`Total drag time: ${totalTime}ms, Movements: ${movements.length}`);
    
    // Verificar stutters: quando o mouse se move mas o elemento não acompanha
    const stutters = movements.filter((m, i) => {
      if (i === 0) return false;
      const prev = movements[i - 1];
      const mouseDistance = Math.sqrt(
        Math.pow(m.mouseX - prev.mouseX, 2) + 
        Math.pow(m.mouseY - prev.mouseY, 2)
      );
      const elementDistance = Math.sqrt(
        Math.pow(m.elementX - prev.elementX, 2) + 
        Math.pow(m.elementY - prev.elementY, 2)
      );
      // Max strict: qualquer atraso perceptível conta como stutter
      return mouseDistance > 4 && elementDistance < 1;
    });
    
    // Verificar movimentos lentos do elemento (não do mouse)
    const slowElementMovements = movements.filter((m, i) => {
      if (i === 0) return false;
      const prev = movements[i - 1];
      const timeDelta = m.time - prev.time;
      const elementDistance = Math.sqrt(
        Math.pow(m.elementX - prev.elementX, 2) + 
        Math.pow(m.elementY - prev.elementY, 2)
      );
      // Max strict: micro-lento conta
      return elementDistance < 3 && timeDelta > 120;
    });
    
    // Verificar "pulos" na posição do elemento (movimentos bruscos)
    const elementJumps = movements.filter((m, i) => {
      if (i === 0) return false;
      const prev = movements[i - 1];
      const elementDistance = Math.sqrt(
        Math.pow(m.elementX - prev.elementX, 2) + 
        Math.pow(m.elementY - prev.elementY, 2)
      );
      // Max strict
      return elementDistance > 40;
    });
    
    // Verificar frames onde o elemento não se moveu (congelamentos)
    const frozenFrames = movements.filter((m, i) => {
      if (i === 0) return false;
      const prev = movements[i - 1];
      const elementDistance = Math.sqrt(
        Math.pow(m.elementX - prev.elementX, 2) + 
        Math.pow(m.elementY - prev.elementY, 2)
      );
      const timeDelta = m.time - prev.time;
      // Max strict
      return elementDistance < 1 && timeDelta > 60;
    });
    
    console.log(`Stutters: ${stutters.length}, Slow element movements: ${slowElementMovements.length}, Element jumps: ${elementJumps.length}, Frozen frames: ${frozenFrames.length}`);
    
    // Assertions - max strict
    expect(movements.length).toBeGreaterThanOrEqual(40);
    expect(stutters.length).toBe(0); // Nenhum stutter permitido
    expect(slowElementMovements.length).toBe(0);
    expect(elementJumps.length).toBeLessThanOrEqual(3);
    expect(frozenFrames.length).toBe(0);
    expect(totalTime).toBeLessThan(30000);
  });

test('should handle library drag without stutters when moving deck multiple times', async ({ page }, testInfo) => {
    const roomId = `test-room-${testInfo.workerIndex}-${Date.now()}`;
    // Host cria a sala
    const menuRoomButton = page.getByTestId('menu-room-button');
    await menuRoomButton.waitFor({ state: 'visible', timeout: 10000 });
    await menuRoomButton.click();
    await page.waitForTimeout(500);
    
    const nameInput = page.getByTestId('room-player-name-input');
    await nameInput.waitFor({ state: 'visible', timeout: 5000 });
    await nameInput.fill('test-user-browser');
    
    const roomIdInput = page.getByTestId('room-id-input');
    await roomIdInput.waitFor({ state: 'visible', timeout: 5000 });
    await roomIdInput.fill(roomId);
    
    const createButton = page.getByTestId('room-create-button');
    await createButton.waitFor({ state: 'visible', timeout: 5000 });
    await createButton.click();
    await page.waitForTimeout(2000);
    
    try {
      const closeButton = page.locator('.modal-close');
      await closeButton.click({ timeout: 2000 });
    } catch (e) {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(500);
    
    // Resetar o board antes de carregar o deck
    page.once('dialog', (dialog) => dialog.accept());
    const resetBoardButton = page.getByTitle('Reset Board');
    await resetBoardButton.waitFor({ state: 'visible', timeout: 10000 });
    await resetBoardButton.click();
    await page.waitForTimeout(1000);
    
    // Carregar deck
    const deckMenuButton = page.getByTitle('Deck Manager');
    await deckMenuButton.waitFor({ state: 'visible', timeout: 10000 });
    await deckMenuButton.click();
    await page.waitForTimeout(1000);
    
    const deckTextarea = page.locator('textarea').first();
    await deckTextarea.waitFor({ state: 'visible', timeout: 5000 });
    await deckTextarea.fill('50 Birds of Paradise');
    
    const loadToLibraryButton = page.getByTestId('load-to-library-button');
    await loadToLibraryButton.waitFor({ state: 'visible', timeout: 5000 });
    await loadToLibraryButton.click();
    await page.waitForTimeout(5000);
    
    // Abrir uma página do peer para validar smoothness
    const peerPage = await page.context().newPage();
    await peerPage.goto('/');
    await peerPage.waitForLoadState('networkidle');

    const peerMenuRoomButton = peerPage.getByTestId('menu-room-button');
    await peerMenuRoomButton.waitFor({ state: 'visible', timeout: 10000 });
    await peerMenuRoomButton.click();
    await peerPage.waitForTimeout(500);

    const peerNameInput = peerPage.getByTestId('room-player-name-input');
    await peerNameInput.waitFor({ state: 'visible', timeout: 5000 });
    await peerNameInput.fill('test-user-browser-peer-view');

    const peerRoomIdInput = peerPage.getByTestId('room-id-input');
    await peerRoomIdInput.waitFor({ state: 'visible', timeout: 5000 });
    await peerRoomIdInput.fill(roomId);

    const peerJoinButton = peerPage.getByTestId('room-join-button');
    await peerJoinButton.waitFor({ state: 'visible', timeout: 5000 });
    await peerJoinButton.click();

    await peerPage.waitForTimeout(5000);
    try {
      const closeButton = peerPage.locator('.modal-close');
      await closeButton.click({ timeout: 2000 });
    } catch (e) {
      await peerPage.keyboard.press('Escape');
    }
    await peerPage.waitForTimeout(500);

    // Encontrar o elemento da library do host no peer
    const peerLibraryElement = peerPage.getByTestId('library-test-user-browser');
    await peerLibraryElement.waitFor({ state: 'visible', timeout: 15000 });

    // Encontrar o elemento da library do host (na página do host)
    const libraryElement = page.getByTestId('library-test-user-browser');
    await libraryElement.waitFor({ state: 'visible', timeout: 15000 });
    
    // Simular múltiplos drags em sequência
    // Monitorar a posição real do elemento durante o movimento (não só no fim)
    const movements: Array<{ 
      mouseX: number; 
      mouseY: number; 
      elementX: number; 
      elementY: number; 
      time: number;
      dragTime: number;
    }> = [];
    const peerMovements: Array<{
      mouseX: number;
      mouseY: number;
      elementX: number;
      elementY: number;
      time: number;
    }> = [];
    const startTime = Date.now();
    
    const initialBoundingBox = await libraryElement.boundingBox();
    if (!initialBoundingBox) {
      throw new Error('Could not get library bounding box');
    }
    
    const halfWidth = initialBoundingBox.width / 2;
    const halfHeight = initialBoundingBox.height / 2;
    
    const boardBox = await page.locator('main.board-fullscreen').boundingBox();
    if (!boardBox) {
      throw new Error('Could not get board bounding box');
    }
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

    // Centralizar no host antes do teste
    const centerX = clamp(
      boardBox.x + boardBox.width / 2,
      boardBox.x + halfWidth,
      boardBox.x + boardBox.width - halfWidth
    );
    const centerY = clamp(
      boardBox.y + boardBox.height / 2,
      boardBox.y + halfHeight,
      boardBox.y + boardBox.height - halfHeight
    );
    const initialX = initialBoundingBox.x + halfWidth;
    const initialY = initialBoundingBox.y + halfHeight;
    await page.mouse.move(initialX, initialY);
    await page.mouse.down();
    await page.mouse.move(centerX, centerY, { steps: 8 });
    await page.mouse.up();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.evaluate(() => new Promise(requestAnimationFrame));
    
    const startX = centerX;
    const startY = centerY;
    
    // Função para obter a posição atual do elemento
    const getElementPosition = async () => {
      const box = await libraryElement.boundingBox();
      if (!box) return null;
      return {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2
      };
    };
    
    const dragCount = 20;
    const moveSteps = 6;
    
    // Fazer movimentos em padrões diferentes (amostrando durante o drag)
    for (let i = 0; i < dragCount; i++) {
      const pattern = i % 4;
      let targetX = startX;
      let targetY = startY;
      
      switch (pattern) {
        case 0: // Círculo
          const angle = (i / 40) * Math.PI * 2;
          targetX = startX + Math.cos(angle) * 100;
          targetY = startY + Math.sin(angle) * 100;
          break;
        case 1: // Linha horizontal
          targetX = startX + (i % 20) * 5;
          targetY = startY;
          break;
        case 2: // Linha vertical
          targetX = startX;
          targetY = startY + (i % 20) * 5;
          break;
        case 3: // Diagonal
          targetX = startX + (i % 20) * 3;
          targetY = startY + (i % 20) * 3;
          break;
      }
      
      targetX = clamp(targetX, boardBox.x + halfWidth, boardBox.x + boardBox.width - halfWidth);
      targetY = clamp(targetY, boardBox.y + halfHeight, boardBox.y + boardBox.height - halfHeight);
      
      // Para cada movimento, fazer um drag completo com amostragem por step
      const currentBox = await libraryElement.boundingBox();
      if (currentBox) {
        const currentX = currentBox.x + currentBox.width / 2;
        const currentY = currentBox.y + currentBox.height / 2;
        const dragStartTime = Date.now();
        
        await page.mouse.move(currentX, currentY);
        await page.mouse.down();
        
        for (let step = 1; step <= moveSteps; step++) {
          const stepX = currentX + ((targetX - currentX) * step) / moveSteps;
          const stepY = currentY + ((targetY - currentY) * step) / moveSteps;
          await page.mouse.move(stepX, stepY);
          await page.evaluate(() => new Promise(requestAnimationFrame));
          await page.evaluate(() => new Promise(requestAnimationFrame));
          
          const stepPos = await getElementPosition();
          movements.push({
            mouseX: stepX,
            mouseY: stepY,
            elementX: stepPos?.x ?? 0,
            elementY: stepPos?.y ?? 0,
            time: Date.now() - startTime,
            dragTime: Date.now() - dragStartTime,
          });

          await page.waitForTimeout(40);
          const peerBox = await peerLibraryElement.boundingBox();
          peerMovements.push({
            mouseX: stepX,
            mouseY: stepY,
            elementX: peerBox ? peerBox.x + peerBox.width / 2 : 0,
            elementY: peerBox ? peerBox.y + peerBox.height / 2 : 0,
            time: Date.now() - startTime,
          });
        }
        await page.mouse.up();
        
        // Aguardar o elemento finalizar o movimento
        await page.waitForTimeout(30);
      }
      
      await page.waitForTimeout(10);
    }
    
    const totalTime = Date.now() - startTime;
    
    // Verificar stutters: quando o mouse se move mas o elemento não acompanha suavemente
    let hostStallCount = 0;
    const stutters = movements.filter((m, i) => {
      if (i === 0) return false;
      const prev = movements[i - 1];
      const mouseDistance = Math.sqrt(
        Math.pow(m.mouseX - prev.mouseX, 2) +
        Math.pow(m.mouseY - prev.mouseY, 2)
      );
      const elementDistance = Math.sqrt(
        Math.pow(m.elementX - prev.elementX, 2) +
        Math.pow(m.elementY - prev.elementY, 2)
      );
      if (mouseDistance > 6 && elementDistance < 1) {
        hostStallCount += 1;
      } else {
        hostStallCount = 0;
      }
      // Max strict
      return hostStallCount >= 2;
    });
    
    // Verificar drags lentos (quando o elemento demora muito para se mover)
    const slowDrags = movements.filter(m => m.dragTime > 500);
    
    // Verificar pulos na posição do elemento
    const elementJumps = movements.filter((m, i) => {
      if (i === 0) return false;
      const prev = movements[i - 1];
      const elementDistance = Math.sqrt(
        Math.pow(m.elementX - prev.elementX, 2) + 
        Math.pow(m.elementY - prev.elementY, 2)
      );
      return elementDistance > 50;
    });
    
    console.log(`Total time: ${totalTime}ms, Stutters: ${stutters.length}, Slow drags: ${slowDrags.length}, Element jumps: ${elementJumps.length}`);

    // Verificar smoothness no peer durante drag do host
    let peerStallCount = 0;
    const peerStutters = peerMovements.filter((m, i) => {
      if (i < 2) return false;
      const prev = peerMovements[i - 1];
      const prev2 = peerMovements[i - 2];
      const mouseDistance = Math.sqrt(
        Math.pow(m.mouseX - prev2.mouseX, 2) +
        Math.pow(m.mouseY - prev2.mouseY, 2)
      );
      const elementDistance = Math.sqrt(
        Math.pow(m.elementX - prev2.elementX, 2) +
        Math.pow(m.elementY - prev2.elementY, 2)
      );
      if (mouseDistance > 6 && elementDistance < 1) {
        peerStallCount += 1;
      } else {
        peerStallCount = 0;
      }
      return peerStallCount >= 2;
    });
    
    // Assertions mais rigorosas
    expect(movements.length).toBeGreaterThanOrEqual(dragCount * moveSteps);
    expect(stutters.length).toBe(0); // Nenhum stutter permitido
    expect(peerStutters.length).toBe(0); // Peer deve acompanhar sem stutter
    expect(slowDrags.length).toBeLessThanOrEqual(3);
    expect(elementJumps.length).toBeLessThanOrEqual(2);
    expect(totalTime).toBeLessThan(15000);
  });
});
