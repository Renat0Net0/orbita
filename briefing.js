(() => {
  const form = document.getElementById('brief-form');
  const button = document.getElementById('send-briefing');
  const feedback = document.getElementById('feedback');

  const serviceIds = {
    'Identidade visual': 1,
    'Site interativo': 2,
    'Estratégia de conteúdo': 3,
    'Campanha digital': 4
  };

  let enviando = false;

  button.addEventListener('click', async () => {
    if (enviando || !form.reportValidity()) return;

    const marca = document.getElementById('brand').value.trim();

    const servicos = [
      ...form.querySelectorAll('[name="service"]:checked')
    ].map(input => serviceIds[input.value]);

    if (!marca) {
      feedback.textContent = 'Informe o nome da sua marca.';
      document.getElementById('brand').focus();
      return;
    }

    if (!servicos.length || servicos.some(id => !id)) {
      feedback.textContent = 'Selecione pelo menos um serviço válido.';
      return;
    }

    const dados = {
      nome: document.getElementById('client-name').value.trim(),
      email: document.getElementById('client-email').value.trim(),
      marca,
      objetivo: document.getElementById('goal').value,
      servicos
    };

    enviando = true;
    button.disabled = true;
    button.textContent = 'Enviando...';
    feedback.textContent = '';

    try {
      const resposta = await fetch('/api/briefings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dados)
      });

      const resultado = await resposta.json();

      if (!resposta.ok) {
        throw new Error(
          resultado.mensagem || 'Não foi possível enviar o pedido.'
        );
      }

      feedback.textContent =
        `Pedido nº ${resultado.briefing_id} cadastrado com sucesso!`;

      button.textContent = 'Pedido enviado';

      // Evita reenviar o mesmo formulário nesta página.
      // Para outro pedido, recarregue a página.
    } catch (erro) {
      feedback.textContent =
        erro instanceof TypeError
          ? 'Falha de conexão. Confira o banco antes de tentar novamente.'
          : erro.message;

      button.disabled = false;
      button.textContent = 'Enviar meu projeto';
    } finally {
      enviando = false;
    }
  });
})();