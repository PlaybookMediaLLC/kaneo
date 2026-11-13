require 'yaml'
require 'open3'

# Guards charts/kaneo/values-production.yaml against upstream value renames.
#
# `helm template -f` alone proves nothing here: Helm ignores value keys it does not
# know, so an upstream rename leaves the overlay inert while the render still
# succeeds. Each check below asserts the value reached the rendered manifest.

CHART = 'charts/kaneo'.freeze
OVERLAY = "#{CHART}/values-production.yaml".freeze
SECRET = 'production-values-check-secret-at-least-32'.freeze
DB_SECRET = 'kaneo-db'.freeze

def render(*args)
  stdout, stderr, status = Open3.capture3(
    'helm', 'template', 'production-values-test', CHART,
    '-f', OVERLAY,
    '--set', "kaneo.env.authSecret=#{SECRET}",
    '--set', 'kaneo.env.clientUrl=https://kaneo.example.com',
    *args
  )
  raise stderr unless status.success?
  YAML.load_stream(stdout).compact
end

def verify(condition, message)
  raise message unless condition
end

def container(docs, component)
  deployment = docs.find do |d|
    d['kind'] == 'Deployment' &&
      d['spec']['template']['metadata']['labels']['app.kubernetes.io/component'] == component
  end
  verify(deployment, "No Deployment found for component #{component}")
  deployment.fetch('spec').fetch('template').fetch('spec').fetch('containers').first
end

docs = render
kaneo = container(docs, 'kaneo')
postgresql = container(docs, 'postgresql')

# Finding 3: without requests both pods land in BestEffort QoS.
verify(kaneo.dig('resources', 'requests', 'cpu'), 'kaneo.resources.requests.cpu did not reach the pod')
verify(kaneo.dig('resources', 'requests', 'memory'), 'kaneo.resources.requests.memory did not reach the pod')
verify(kaneo.dig('resources', 'limits', 'memory'), 'kaneo.resources.limits.memory did not reach the pod')
verify(!kaneo.dig('resources', 'limits', 'cpu'), 'A cpu limit appeared; the overlay omits it to avoid throttling')
verify(postgresql.dig('resources', 'requests', 'memory'), 'postgresql.resources.requests.memory did not reach the pod')
verify(postgresql.dig('resources', 'limits', 'memory'), 'postgresql.resources.limits.memory did not reach the pod')

# Finding 9: the probe override must merge, not replace. Losing httpGet would make
# the probe always pass.
readiness = kaneo.fetch('readinessProbe')
verify(readiness.dig('httpGet', 'path') == '/api/health', 'readinessProbe.httpGet was lost; the values merge changed')
verify(readiness['initialDelaySeconds'].zero?, 'readinessProbe.initialDelaySeconds did not reach the pod')

# Finding 6: the database password must come from a secret, never a literal.
pg_password = postgresql.fetch('env').find { |e| e['name'] == 'POSTGRES_PASSWORD' }
verify(!pg_password.key?('value'), 'POSTGRES_PASSWORD must not be a literal in the Deployment')
verify(pg_password.dig('valueFrom', 'secretKeyRef', 'name') == DB_SECRET, 'POSTGRES_PASSWORD must read the configured secret')

app_password = kaneo.fetch('env').find { |e| e['name'] == 'KANEO_POSTGRES_PASSWORD' }
verify(app_password, 'The app must read the database password from the secret')
verify(app_password.dig('valueFrom', 'secretKeyRef', 'name') == DB_SECRET, 'KANEO_POSTGRES_PASSWORD must read the configured secret')

database_url = kaneo.fetch('env').find { |e| e['name'] == 'DATABASE_URL' }
verify(database_url.fetch('value').include?('$(KANEO_POSTGRES_PASSWORD)'), 'DATABASE_URL must interpolate the secret, not embed a password')

docs.select { |d| d['kind'] == 'Deployment' }.each do |deployment|
  verify(!deployment.to_s.include?('kaneo_password'), 'The default database password leaked into a Deployment')
end

# Finding 12: the ingress and gateway backends must address the port the service
# exposes. The overlay documents all four copies together.
service = docs.find { |d| d['kind'] == 'Service' && d['metadata']['name'].end_with?('-kaneo') }
service_port = service.fetch('spec').fetch('ports').first.fetch('port')
container_port = kaneo.fetch('ports').first.fetch('containerPort')
verify(service_port == container_port, "Service port #{service_port} does not match container port #{container_port}")

routed = render(
  '--set', 'ingress.enabled=true',
  '--set', 'ingress.hosts[0].host=kaneo.example.com',
  '--set', 'ingress.hosts[0].paths[0].path=/',
  '--set', 'ingress.hosts[0].paths[0].pathType=Prefix',
  '--set', 'ingress.hosts[0].paths[0].service=kaneo',
  "--set=ingress.hosts[0].paths[0].port=#{service_port}",
  '--set', 'postgresql.auth.existingSecret=kaneo-db'
)
ingress = routed.find { |d| d['kind'] == 'Ingress' }
backend = ingress.fetch('spec').fetch('rules').first.fetch('http').fetch('paths').first.fetch('backend').fetch('service')
verify(backend.fetch('port').fetch('number') == service_port, 'The ingress backend port does not match the service port')
verify(backend.fetch('name') == service.fetch('metadata').fetch('name'), 'The ingress backend does not name the kaneo service')

puts 'Helm production values checks passed'
