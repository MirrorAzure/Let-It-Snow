# Улучшения физики ветра (Wind Physics Improvements)

## Описание изменений / Description of Changes

Реализована более физически корректная модель ветра в расширении Let It Snow. Ветер теперь воздействует на снежинки как реальная физическая сила, а не просто смещение позиции.

A more physically accurate wind model has been implemented in the Let It Snow extension. Wind now affects snowflakes as a real physical force, rather than just position displacement.

## Основные улучшения / Key Improvements

### 1. **Многослойная турбулентность ветра / Multi-layer Wind Turbulence**
   - Ветер генерируется из трех слоев с разными частотами (low, mid, high)
   - Основной цикл (низкая частота - 70% мощности): общее направление и порывы
   - Среднечастотные вихри (20% мощности): вариативность движения
   - Высокочастотная турбулентность (10% мощности): мелкие вихри и реалистичность
   
   Wind is generated from three frequency layers:
   - Base cycle (low frequency - 70% power): overall direction and gusts
   - Mid-frequency vortices (20% power): movement variability  
   - High-frequency turbulence (10% power): small eddies and realism

### 2. **Ветер как сила, а не смещение / Wind as Force, not Displacement**
   - **До**: ветер применялся как постоянное смещение позиции (это было нереалистично)
   - **После**: ветер применяется как ускорение (дополнительная сила), которая добавляется к velocityX
   
   **Before**: wind was applied as constant position displacement (unrealistic)
   **After**: wind is applied as acceleration (additional force) added to velocityX

### 3. **Зависимость от площади поперечного сечения / Cross-section Area Dependency**
   - Ветер воздействует сильнее на маленькие снежинки (меньше инертия, больше площадь относительно массы)
   - Площадь сечения вычисляется как квадрат размера: `(size / 20)²`
   - Большие снежинки более устойчивы к ветру
   
   Wind affects small snowflakes more strongly (less inertia, larger area-to-mass ratio)
   Cross-section area calculated as: `(size / 20)²`
   Large snowflakes are more resistant to wind

### 4. **Вертикальная составляющая ветра (Лифт) / Vertical Wind Component (Lift)**
   - При сильных горизонтальных ветрах создается восходящий поток с величиной до 30% от основной силы ветра
   - Это позволяет ветру "поднимать" снежинки, создавая более реалистичный эффект
   - Лифт `= abs(windMagnitude) × 0.3 × windStrength`
   
   Strong horizontal winds create upward lift up to 30% of wind force
   This allows wind to "lift" snowflakes for more realistic effects
   Lift `= abs(windMagnitude) × 0.3 × windStrength`

### 5. **Вертикальное ускорение при лифте / Vertical Acceleration from Lift**
   - Лифт добавляется как отрицательное вертикальное ускорение (вверх)
   - Величина: `liftAccel = -currentWindLift × crossSection × 1.5`
   
   Lift applied as negative vertical acceleration (upward)
   Magnitude: `liftAccel = -currentWindLift × crossSection × 1.5`

## Физическое обоснование / Physical Justification

1. **Зависимость от размера / Size Dependency**: 
   - Маленькие объекты сильнее подвержены аэродинамическому воздействию
   - Формула: сила воздействия ∝ площадь поперечного сечения / масса

2. **Многослойность турбулентности / Turbulence Hierarchy**:
   - Реальный ветер содержит вихри разных масштабов (каскад энергии Колмогорова)
   - Мы имитируем это тремя слоями синусоидальных функций

3. **Лифт при ветре / Lift from Wind**:
   - Согласно принципу Бернулли и эффекту Магнуса, движение воздуха может создавать подъемную силу
   - На роль профиля крыла здесь играет форма снежинки

## Технические детали / Technical Details

### Файлы с изменениями / Modified Files:
- `src/content/fallback-2d-renderer.js` - 2D Canvas рендерер
- `src/content/webgpu-renderer.js` - WebGPU рендерер

### Параметры конфигурации / Configuration Parameters:
```javascript
windEnabled: boolean       // Включить ветер / Enable wind
windDirection: string      // 'left', 'right', 'random'
windStrength: number       // 0-1: сила ветра / Wind strength (0-1)
windGustFrequency: number  // Частота порывов в секундах / Gust frequency in seconds
```

## Примеры поведения / Behavior Examples

### Слабый ветер (windStrength = 0.3)
- Маленькие снежинки слегка отклоняются
- Большие снежинки падают почти вертикально
- Лифт минимальный

### Средний ветер (windStrength = 0.5)
- Снежинки дрейфуют горизонтально
- Видны порывы и турбулентность
- Легкий лифт при сильных порывах

### Сильный ветер (windStrength = 0.8 и выше)
- Все снежинки сильно сносятся ветром
- Видна четкая турбулентность
- Маленькие снежинки могут подниматься вверх на короткое время

## Сравнение с реальными явлениями / Comparison with Real Phenomena

| Параметр | Let It Snow | Реальность |
|----------|-------------|-----------|
| Зависимость от размера | ✓ (квадратичная) | ✓ |
| Ламинарное течение | ✗ (только турбулентное) | ~ (в основном турбулентное) |
| Лифт | ✓ (при сильных ветрах) | ✓ |
| Вихри разных масштабов | ✓ (3 слоя) | ✓ (бесконечное множество) |
| Влияние на диаметр | ✓ | ✓ |

## Future Improvements / Будущие улучшения

- Добавление настоящего шума Перлина для более естественной турбулентности
- Симуляция шаровых грозовых разрядов (St. Elmo's fire эффект)
- Пространственная турбулентность (разные ветры на разных высотах)
- Физика столкновения снежинок с учетом ветра
