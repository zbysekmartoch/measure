# LaTeX Markdown - Math Expressions ✨

Markdown Math extension používá pro matematické výrazy zjednodušenou LaTeX syntaxi.

## Quick Examples

### Basic LaTeX in Markdown

**Inline math**: Einstein's famous equation $E = mc^2$ demonstrates mass-energy equivalence.

**Display math** - Newton's second law:

$$
F = ma
$$

### Common Use Cases

#### 1. Calculus & Derivatives
$$
\frac{d}{dx}(x^2) = 2x \quad \text{and} \quad \int x^2 dx = \frac{x^3}{3} + C
$$

#### 2. Fractions
$$
\frac{a}{b} + \frac{c}{d} = \frac{ad + bc}{bd}
$$

#### 3. Square Root in Markdown
$$
\sqrt{16} = 4 \quad \text{and} \quad \sqrt[3]{27} = 3
$$

#### 4. Greek Letters in Markdown
$$
\alpha + \beta = \gamma \quad \theta = 45° \quad \pi \approx 3.14159
$$

Common Greek letters: $\alpha$, $\beta$, $\gamma$, $\delta$, $\epsilon$, $\theta$, $\lambda$, $\mu$, $\pi$, $\sigma$, $\omega$

#### 5. Summation & Products
$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2} \quad \prod_{i=1}^{n} i = n!
$$

#### 6. Matrix 
$$
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
\begin{pmatrix}
x \\
y
\end{pmatrix} =
\begin{pmatrix}
ax + by \\
cx + dy
\end{pmatrix}
$$

#### 7. Limits
$$
\lim_{x \to 0} \frac{\sin x}{x} = 1
$$

#### 8. Integrals
$$
\int_0^{\pi} \sin x \, dx = 2
$$

#### 9. Statistics
$$
\mu = \frac{1}{n}\sum_{i=1}^n x_i \quad \sigma^2 = \frac{1}{n}\sum_{i=1}^n (x_i - \mu)^2
$$

#### 10. Quadratic Formula
$$
x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}
$$

## Advanced Features

### Aligned Equations 
$$
\begin{align*}
(x+y)^2 &= x^2 + 2xy + y^2 \\
(x-y)^2 &= x^2 - 2xy + y^2 \\
(x+y)(x-y) &= x^2 - y^2
\end{align*}
$$

### Piecewise Functions
$$
f(x) = \begin{cases}
x^2 & \text{if } x \geq 0 \\
-x^2 & \text{if } x < 0
\end{cases}
$$

### Systems of Equations
$$
\begin{cases}
x + 2y = 5 \\
3x - y = 4
\end{cases}
$$

### Trigonometry
$$
\sin^2\theta + \cos^2\theta = 1 \quad \tan\theta = \frac{\sin\theta}{\cos\theta}
$$