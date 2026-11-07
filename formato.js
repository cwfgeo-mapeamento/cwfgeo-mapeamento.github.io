/* Leitura do link do QR do modelo digital da CWF GEO (o trecho depois do "#").
   Par de cwf/qr_link.py na Estação CWF: lá o link é escrito, aqui é lido. Esta página entende TODAS as versões do
   formato já usadas em plantas entregues; versão nova = acrescentar aqui, nunca mudar a leitura de uma antiga.
   Roda no navegador (window.CwfFormato) e no Node (os testes da Estação decodificam os mesmos exemplos). */
(function (raiz) {
  'use strict';
  var ALFABETO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:';
  var ESCALA = 100000;
  var TIPOS = 'MPV';

  function Erro(tipo, texto) {
    var e = new Error(texto);
    e.tipo = tipo;
    return e;
  }

  function deBase43(s) {
    var v = [], i, n;
    for (i = 0; i < s.length; i++) {
      n = ALFABETO.indexOf(s.charAt(i));
      if (n < 0) throw Erro('quebrado', 'Caractere fora do formato no link.');
      v.push(n);
    }
    if (v.length % 3 === 1) throw Erro('quebrado', 'Link cortado.');
    var out = [];
    for (i = 0; i + 2 < v.length; i += 3) {
      n = v[i] + v[i + 1] * 43 + v[i + 2] * 1849;
      if (n > 65535) throw Erro('quebrado', 'Link mexido.');
      out.push(n >> 8, n & 255);
    }
    if (v.length % 3 === 2) {
      n = v[v.length - 2] + v[v.length - 1] * 43;
      if (n > 255) throw Erro('quebrado', 'Link mexido.');
      out.push(n);
    }
    return out;
  }

  function crc8(b, fim) {
    var c = 0, i, j;
    for (i = 0; i < fim; i++) {
      c ^= b[i];
      for (j = 0; j < 8; j++) c = (c & 0x80) ? ((c << 1) ^ 0x07) & 0xFF : (c << 1) & 0xFF;
    }
    return c;
  }

  function Leitor(bytes, fim) {
    this.b = bytes;
    this.fim = fim * 8;
    this.i = 0;
  }
  Leitor.prototype.bit = function () {
    if (this.i >= this.fim) throw Erro('quebrado', 'Link incompleto.');
    var k = this.i++;
    return (this.b[k >> 3] >> (7 - (k & 7))) & 1;
  };
  Leitor.prototype.get = function (n) {
    var v = 0;
    for (var k = 0; k < n; k++) v = v * 2 + this.bit();
    return v;
  };
  Leitor.prototype.eg = function (k) {          // Exp-Golomb de ordem k
    var z = 0;
    while (this.bit() === 0) {
      if (++z > 40) throw Erro('quebrado', 'Link mexido.');
    }
    var x = 1;
    for (var j = 0; j < z + k; j++) x = x * 2 + this.bit();
    return x - Math.pow(2, k);
  };
  function dezz(v) { return v % 2 === 0 ? v / 2 : -(v + 1) / 2; }
  Leitor.prototype.zz = function (k) { return dezz(this.eg(k)); };
  Leitor.prototype.txt = function () {
    var n = this.eg(3), b = new Uint8Array(n);
    for (var j = 0; j < n; j++) b[j] = this.get(8);
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  };

  function lerFormato1(L) {
    var r = { formato: 1, titulo: L.txt(), municipio: L.txt(), area: L.txt(), perimetro: L.txt(), parcelas: [] };
    var nParc = L.eg(0) + 1, i, j;
    r.corte = L.get(2);
    r.tolerancia = r.corte === 3 ? L.eg(0) / 10 : 0;
    var estilos = [], nEst = L.eg(0);
    for (i = 0; i < nEst; i++) estilos.push({ cabeca: L.txt(), sep: L.get(1) ? '-' : '', largura: L.eg(0) });
    var temLiteral = L.get(1) === 1;             // a opção depois dos estilos = código literal
    var bOpcao = 0;                              // teto(log2(opções)); uma opção só = 0 bit
    while ((1 << bOpcao) < nEst + (temLiteral ? 1 : 0)) bOpcao++;
    var ultimo = 0;
    var parcelasBrutas = [];
    for (i = 0; i < nParc; i++) {
      var p = { nome: L.txt(), area: L.txt(), pontos: [] };
      var n = L.eg(4), k = L.get(5);
      var la = dezz(L.get(26)), lo = dezz(L.get(26));
      p.pontos.push({ lat: la / ESCALA, lon: lo / ESCALA, tipo: null, codigo: null });
      for (j = 1; j < n; j++) {
        la += L.zz(k);
        lo += L.zz(k);
        p.pontos.push({ lat: la / ESCALA, lon: lo / ESCALA, tipo: null, codigo: null });
      }
      if (r.corte < 3) {
        for (j = 0; j < n; j++) p.pontos[j].tipo = TIPOS.charAt(L.get(2));
        if (r.corte < 2) {
          var kn = L.get(5);
          for (j = 0; j < n; j++) {
            var pt = p.pontos[j];
            if (!(r.corte === 0 || pt.tipo === 'M')) continue;
            var op = L.get(bOpcao);
            if (op < nEst) {
              ultimo += L.zz(kn);
              var num = String(ultimo);
              while (num.length < estilos[op].largura) num = '0' + num;
              pt.codigo = estilos[op].cabeca + pt.tipo + estilos[op].sep + num;
            } else {
              pt.codigo = L.txt();
            }
          }
        }
      }
      parcelasBrutas.push(p);
    }
    r.parcelas = parcelasBrutas;
    return r;
  }

  function ler(trecho) {
    var s = String(trecho || '').replace(/^#/, '');
    try { s = decodeURIComponent(s); } catch (e) { /* fica como veio */ }
    s = s.replace(/\s+/g, '').toUpperCase();
    if (!s) throw Erro('vazio', 'Este endereço não traz um imóvel.');
    var formato = ALFABETO.indexOf(s.charAt(0));
    if (formato !== 1) throw Erro('formato', 'Este QR é de uma versão mais nova: atualize a página.');
    var b = deBase43(s.slice(1));
    if (b.length < 2 || crc8(b, b.length - 1) !== b[b.length - 1]) throw Erro('quebrado', 'Link incompleto ou mexido.');
    return lerFormato1(new Leitor(b, b.length - 1));
  }

  raiz.CwfFormato = { ler: ler, ALFABETO: ALFABETO };
  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.CwfFormato;
})(typeof window !== 'undefined' ? window : globalThis);
